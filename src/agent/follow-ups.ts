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
export type FollowUpTrigger=FollowUpInput & {triggerId:string;status:'scheduled'|'attempting'|'sent'|'uncertain'|'cancelled';receiptId?:string;decisionReason?:string};
const idFor=(v:FollowUpInput)=>createHash('sha256').update(JSON.stringify([v.brandId,v.contactId,v.reason,v.sourceWorkflowId])).digest('hex');
export class FollowUpStore {
 private db:Database;
 constructor({dbPath='./data/agent-followups.sqlite'}:{dbPath?:string}={}) {
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
  this.db=new Database(dbPath);
  this.db.run('PRAGMA journal_mode = WAL');
  this.db.run('PRAGMA busy_timeout = 5000');
  this.db.run('CREATE TABLE IF NOT EXISTS engagement_triggers(trigger_id TEXT PRIMARY KEY,brand_id TEXT NOT NULL,contact_id TEXT NOT NULL,reason TEXT NOT NULL,due_at INTEGER NOT NULL,source_workflow_id TEXT NOT NULL,consent_ref TEXT,template_ref TEXT,status TEXT NOT NULL,receipt_id TEXT,updated_at INTEGER NOT NULL,decision_reason TEXT)');
  // Additive migration for databases created before durable decision tracking.
  if(!this.db.query<{name:string}, []>('PRAGMA table_info(engagement_triggers)').all().some(row=>row.name==='decision_reason')) {
   this.db.run('ALTER TABLE engagement_triggers ADD COLUMN decision_reason TEXT');
  }
  this.db.run('CREATE INDEX IF NOT EXISTS idx_followup_due ON engagement_triggers(status,due_at)');
  this.db.run('CREATE TABLE IF NOT EXISTS engagement_optouts(brand_id TEXT NOT NULL,contact_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(brand_id,contact_id))');
 }
 schedule(input:FollowUpInput):string {
  if(!input.brandId || !input.contactId || !input.reason || !input.sourceWorkflowId || !Number.isFinite(input.dueAt))throw new Error('Invalid followup');
  const id=idFor(input);
  // Serialize opt-out checks and new schedules against competing SQLite writers.
  this.db.transaction(()=>{
   if(this.db.query('SELECT 1 FROM engagement_optouts WHERE brand_id=? AND contact_id=? LIMIT 1').get(input.brandId,input.contactId)){
    throw new Error('Contact opted out of proactive engagement');
   }
   this.db.query('INSERT OR IGNORE INTO engagement_triggers(trigger_id,brand_id,contact_id,reason,due_at,source_workflow_id,consent_ref,template_ref,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,input.brandId,input.contactId,input.reason,input.dueAt,input.sourceWorkflowId,input.consentRef??null,input.templateRef??null,'scheduled',Date.now());
  }).immediate();
  return id;
 }
 get(id:string):FollowUpTrigger|null {
  const row=this.db.query<Record<string, unknown>, [string]>(
   'SELECT trigger_id,brand_id,contact_id,reason,due_at,source_workflow_id,consent_ref,template_ref,status,receipt_id,decision_reason FROM engagement_triggers WHERE trigger_id=? LIMIT 1'
  ).get(id);
  if (!row) return null;
  const { trigger_id, brand_id, contact_id, reason, due_at, source_workflow_id,
   consent_ref, template_ref, status, receipt_id, decision_reason } = row;
  if (typeof trigger_id !== 'string' || typeof brand_id !== 'string' || typeof contact_id !== 'string' ||
   typeof reason !== 'string' || typeof due_at !== 'number' || !Number.isFinite(due_at) ||
   typeof source_workflow_id !== 'string' ||
   (consent_ref !== null && typeof consent_ref !== 'string') ||
   (template_ref !== null && typeof template_ref !== 'string') ||
   (receipt_id !== null && typeof receipt_id !== 'string') ||
   (decision_reason !== null && typeof decision_reason !== 'string') ||
   (status !== 'scheduled' && status !== 'attempting' && status !== 'sent' && status !== 'uncertain' && status !== 'cancelled')) {
   return null;
  }
  return {
   triggerId:trigger_id,brandId:brand_id,contactId:contact_id,reason,dueAt:due_at,
   sourceWorkflowId:source_workflow_id,consentRef:consent_ref??undefined,templateRef:template_ref??undefined,
   status,receiptId:receipt_id??undefined,decisionReason:decision_reason??undefined
  };
 }
 /** A bounded due scan; dispatch still owns the atomic status claim. */
 listDue(now:number,limit=25):FollowUpTrigger[] {
  if(!Number.isFinite(now)||!Number.isSafeInteger(limit)||limit<1)throw new Error('Invalid due-scan parameters');
  const ids=this.db.query<{trigger_id:string}, [number, number]>("SELECT trigger_id FROM engagement_triggers WHERE status='scheduled' AND due_at<=? ORDER BY due_at ASC,trigger_id ASC LIMIT ?")
   .all(now,Math.min(limit,100));
  return ids.map(row=>this.get(row.trigger_id)).filter((row):row is FollowUpTrigger=>row!==null);
 }
 /** Attempts from an earlier process are read-only reconciliation candidates. */
 listUnresolved(limit=25):FollowUpTrigger[] {
  if(!Number.isSafeInteger(limit)||limit<1)throw new Error('Invalid reconciliation limit');
  const ids=this.db.query<{trigger_id:string}, [number]>("SELECT trigger_id FROM engagement_triggers WHERE status IN ('attempting','uncertain') ORDER BY due_at ASC,trigger_id ASC LIMIT ?")
   .all(Math.min(limit,100));
  return ids.map(row=>this.get(row.trigger_id)).filter((row):row is FollowUpTrigger=>row!==null);
 }
 /** Permanent denial is terminal: no repeated skipped events or due-scan starvation. */
 cancel(id:string,reason:string):boolean {
  if(!id||!reason)throw new Error('Invalid cancellation');
  const changed=this.db.query("UPDATE engagement_triggers SET status='cancelled',decision_reason=?,updated_at=? WHERE trigger_id=? AND status='scheduled'").run(reason,Date.now(),id);
  return changed.changes===1;
 }
 /** Move a temporary deferral out of the due queue; revalidate eligibility later. */
 deferUntil(id:string,nextDueAt:number,reason:string):boolean {
  if(!Number.isSafeInteger(nextDueAt)||!reason)throw new Error('Invalid deferral');
  const changed=this.db.query("UPDATE engagement_triggers SET due_at=?,decision_reason=?,updated_at=? WHERE trigger_id=? AND status='scheduled' AND due_at<?")
   .run(nextDueAt,reason,Date.now(),id,nextDueAt);
  return changed.changes===1;
 }
 /** External intent acceptance is evidence only; no transport is called here. */
 reconcileFailed(id:string,reason:'template_policy_denied'|'recipient_binding_changed'):boolean {
  const changed=this.db.query("UPDATE engagement_triggers SET status='cancelled',decision_reason=?,updated_at=? WHERE trigger_id=? AND status IN ('attempting','uncertain')")
   .run(reason,Date.now(),id);
  return changed.changes===1;
 }
 reconcileAccepted(id:string,receiptId:string):boolean {
  if(typeof receiptId!=='string'||!receiptId.trim()||receiptId.length>512)throw new Error('Invalid provider receipt');
  const result=this.db.query("UPDATE engagement_triggers SET status='sent',receipt_id=?,updated_at=? WHERE trigger_id=? AND status IN ('attempting','uncertain')")
   .run(receiptId,Date.now(),id);
  return result.changes===1;
 }
 optOut(brandId:string,contactId:string):string[] {
  let ids: string[] = [];
  this.db.transaction(()=>{
   this.db.query('INSERT OR IGNORE INTO engagement_optouts(brand_id,contact_id,created_at) VALUES(?,?,?)').run(brandId,contactId,Date.now());
   const rows=this.db.query<{trigger_id:string}, [number, string, string]>("UPDATE engagement_triggers SET status='cancelled',decision_reason='opted_out',updated_at=? WHERE brand_id=? AND contact_id=? AND status='scheduled' RETURNING trigger_id")
    .all(Date.now(),brandId,contactId);
   ids = rows.map(row=>row.trigger_id);
  }).immediate();
  return ids;
 }
 onCustomerReply(brandId:string,contactId:string):string[] {
  const rows=this.db.query<{trigger_id:string}, [number, string, string]>("UPDATE engagement_triggers SET status='cancelled',decision_reason='customer_replied',updated_at=? WHERE brand_id=? AND contact_id=? AND status='scheduled' RETURNING trigger_id")
   .all(Date.now(),brandId,contactId);
  return rows.map(row=>row.trigger_id);
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
  if(!Number.isInteger(ctx.quietHours.from)||!Number.isInteger(ctx.quietHours.to)||ctx.quietHours.from<0||ctx.quietHours.from>24||ctx.quietHours.to<0||ctx.quietHours.to>24)throw new Error('Invalid quiet hours');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:ctx.timeZone,hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ctx.now));
  const hour=Number(parts.find(p=>p.type==='hour')?.value);
  const {from,to}=ctx.quietHours;
  const quiet=from<to?(hour>=from && hour<to):from>to?(hour>=from || hour<to):false;
  if(quiet)return {decision:'defer',reason:'quiet_hours'};
  return {decision:'send',reason:'eligible'};
 }
 async dispatch(id:string,ctx:FollowUpEvaluation,sender:(trigger:FollowUpTrigger)=>Promise<string>):Promise<{status:'sent'|'uncertain'|'skipped'|'deferred';reason?:string;receiptId?:string}> {
  const current=this.get(id);
  if(current?.status==='sent')return {status:'sent',receiptId:current.receiptId};
  if(current?.status==='attempting'||current?.status==='uncertain')return {status:'uncertain',reason:'reconciliation_required'};
  const decision=this.evaluate(id,ctx);
  if(decision.decision!=='send')return {status:decision.decision==='defer'?'deferred':'skipped',reason:decision.reason};
  const claim=this.db.query("UPDATE engagement_triggers SET status='attempting',updated_at=? WHERE trigger_id=? AND status='scheduled'").run(Date.now(),id);
  if(claim.changes!==1)return {status:'uncertain',reason:'concurrent_or_previous_attempt'};
  try{
   const claimed = this.get(id);
   if (!claimed) throw new Error('Claimed follow-up trigger not found');
   const receipt=await sender(claimed);
   if(!receipt)throw new Error('Missing provider receipt');
   this.db.query("UPDATE engagement_triggers SET status='sent',receipt_id=?,updated_at=? WHERE trigger_id=? AND status='attempting'").run(receipt,Date.now(),id);
   return {status:'sent',receiptId:receipt};
  }catch{
   const changed=this.db.query("UPDATE engagement_triggers SET status='uncertain',updated_at=? WHERE trigger_id=? AND status='attempting'").run(Date.now(),id);
   if(changed.changes===0 && this.get(id)?.status==='cancelled'){
    return {status:'skipped',reason:this.get(id)?.decisionReason??'template_policy_denied'};
   }
   return {status:'uncertain',reason:'provider_outcome_unknown'};
  }
 }
 close(){this.db.close()}
}
