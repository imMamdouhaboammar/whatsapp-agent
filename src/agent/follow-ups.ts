import {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {mkdirSync} from 'node:fs';

export interface FollowUpInput {
 brandId:string;contactId:string;reason:string;dueAt:number;sourceWorkflowId:string;consentRef?:string;templateRef?:string;
}
export interface FollowUpEvaluation {
 now:number;channel:'meta-cloud'|'baileys';optIn:boolean;templateApproved:boolean;timeZone:string;quietHours:{from:number;to:number};
}
type Trigger=FollowUpInput & {triggerId:string;status:'scheduled'|'attempting'|'sent'|'uncertain'|'cancelled';receiptId?:string};
const idFor=(v:FollowUpInput)=>createHash('sha256').update(JSON.stringify([v.brandId,v.contactId,v.reason,v.sourceWorkflowId])).digest('hex');
export class FollowUpStore {
 private db:Database;
 constructor({dbPath='./data/agent-followups.sqlite'}:{dbPath?:string}={}) {
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
  this.db=new Database(dbPath);
  this.db.run('PRAGMA journal_mode = WAL');
  this.db.run('PRAGMA busy_timeout = 5000');
  this.db.run('CREATE TABLE IF NOT EXISTS engagement_triggers(trigger_id TEXT PRIMARY KEY,brand_id TEXT NOT NULL,contact_id TEXT NOT NULL,reason TEXT NOT NULL,due_at INTEGER NOT NULL,source_workflow_id TEXT NOT NULL,consent_ref TEXT,template_ref TEXT,status TEXT NOT NULL,receipt_id TEXT,updated_at INTEGER NOT NULL)');
  this.db.run('CREATE INDEX IF NOT EXISTS idx_followup_due ON engagement_triggers(status,due_at)');
  this.db.run('CREATE TABLE IF NOT EXISTS engagement_optouts(brand_id TEXT NOT NULL,contact_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(brand_id,contact_id))');
 }
 schedule(input:FollowUpInput):string {
  if(!input.brandId || !input.contactId || !input.reason || !input.sourceWorkflowId || !Number.isFinite(input.dueAt))throw new Error('Invalid followup');
  const id=idFor(input);
  this.db.query('INSERT OR IGNORE INTO engagement_triggers(trigger_id,brand_id,contact_id,reason,due_at,source_workflow_id,consent_ref,template_ref,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,input.brandId,input.contactId,input.reason,input.dueAt,input.sourceWorkflowId,input.consentRef??null,input.templateRef??null,'scheduled',Date.now());
  return id;
 }
 get(id:string):Trigger|null {
  const row=this.db.query('SELECT * FROM engagement_triggers WHERE trigger_id=? LIMIT 1').get(id) as any;
  return row?{triggerId:row.trigger_id,brandId:row.brand_id,contactId:row.contact_id,reason:row.reason,dueAt:row.due_at,sourceWorkflowId:row.source_workflow_id,consentRef:row.consent_ref??undefined,templateRef:row.template_ref??undefined,status:row.status,receiptId:row.receipt_id??undefined}:null;
 }
 optOut(brandId:string,contactId:string) {
  const op=this.db.transaction(()=>{
   this.db.query('INSERT OR IGNORE INTO engagement_optouts(brand_id,contact_id,created_at) VALUES(?,?,?)').run(brandId,contactId,Date.now());
   this.db.query("UPDATE engagement_triggers SET status='cancelled',updated_at=? WHERE brand_id=? AND contact_id=? AND status='scheduled'").run(Date.now(),brandId,contactId);
  });op();
 }
 onCustomerReply(brandId:string,contactId:string) {
  this.db.query("UPDATE engagement_triggers SET status='cancelled',updated_at=? WHERE brand_id=? AND contact_id=? AND status='scheduled'").run(Date.now(),brandId,contactId);
 }
 evaluate(id:string,ctx:FollowUpEvaluation):{decision:'send'|'skip'|'defer';reason:string} {
  const followup=this.get(id);
  if(!followup)return {decision:'skip',reason:'not_found'};
  if(followup.status!=='scheduled')return {decision:'skip',reason:followup.status};
  if(this.db.query('SELECT 1 FROM engagement_optouts WHERE brand_id=? AND contact_id=? LIMIT 1').get(followup.brandId,followup.contactId))return {decision:'skip',reason:'opted_out'};
  if(!ctx.optIn || !followup.consentRef)return {decision:'skip',reason:'missing_consent'};
  if(ctx.channel!=='meta-cloud')return {decision:'skip',reason:'unsupported_channel'};
  if(!ctx.templateApproved || !followup.templateRef)return {decision:'skip',reason:'no_approved_template'};
  if(ctx.now<followup.dueAt)return {decision:'defer',reason:'not_due'};
  if(!Number.isInteger(ctx.quietHours.from)||!Number.isInteger(ctx.quietHours.to)||ctx.quietHours.from<0||ctx.quietHours.to>24)throw new Error('Invalid quiet hours');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:ctx.timeZone,hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ctx.now));
  const hour=Number(parts.find(p=>p.type==='hour')?.value);
  const {from,to}=ctx.quietHours;
  const quiet=from<to?(hour>=from && hour<to):from>to?(hour>=from || hour<to):false;
  if(quiet)return {decision:'defer',reason:'quiet_hours'};
  return {decision:'send',reason:'eligible'};
 }
 async dispatch(id:string,ctx:FollowUpEvaluation,sender:(trigger:Trigger)=>Promise<string>):Promise<{status:'sent'|'uncertain'|'skipped'|'deferred';reason?:string;receiptId?:string}> {
  const current=this.get(id);
  if(current?.status==='sent')return {status:'sent',receiptId:current.receiptId};
  if(current?.status==='attempting'||current?.status==='uncertain')return {status:'uncertain',reason:'reconciliation_required'};
  const decision=this.evaluate(id,ctx);
  if(decision.decision!=='send')return {status:decision.decision==='defer'?'deferred':'skipped',reason:decision.reason};
  const claim=this.db.query("UPDATE engagement_triggers SET status='attempting',updated_at=? WHERE trigger_id=? AND status='scheduled'").run(Date.now(),id);
  if(claim.changes!==1)return {status:'uncertain',reason:'concurrent_or_previous_attempt'};
  try{
   const receipt=await sender(this.get(id)!);
   if(!receipt)throw new Error('Missing provider receipt');
   this.db.query("UPDATE engagement_triggers SET status='sent',receipt_id=?,updated_at=? WHERE trigger_id=? AND status='attempting'").run(receipt,Date.now(),id);
   return {status:'sent',receiptId:receipt};
  }catch{
   this.db.query("UPDATE engagement_triggers SET status='uncertain',updated_at=? WHERE trigger_id=? AND status='attempting'").run(Date.now(),id);
   return {status:'uncertain',reason:'provider_outcome_unknown'};
  }
 }
 close(){this.db.close()}
}
