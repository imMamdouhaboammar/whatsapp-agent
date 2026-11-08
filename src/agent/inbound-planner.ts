import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ChatMessage } from '../domain/types';
import type { ModeratorAgent } from '../ai/moderator-agent';
import type { BoundedPlanner, PlannerGoal, PlannerOutcome } from './bounded-planner';
import type { ToolRegistry } from './tools';

type DecisionResult = Awaited<ReturnType<ModeratorAgent['processInboundMessage']>>;
type Env = Readonly<Record<string,string|undefined>>;
export interface InboundPlannerPolicy {
  brandId:string;
  allowedScopes:string[];
  allowWrites:boolean;
  maxSteps:number;
}

/**
 * Explicit owner settings, never parsed from inbound WhatsApp content.
 * The brand must be selected in both the agent instance and owner env.
 */
export function resolveInboundPlannerPolicy({env,brandId}:{env:Env;brandId?:string}):InboundPlannerPolicy|null {
  if(env.AGENT_PLANNER_INBOUND!=='1' || !brandId || !/^[A-Za-z0-9_-]{1,64}$/.test(brandId) ||
     env.AGENT_PLANNER_BRAND_ID!==brandId) return null;
  const value=env.AGENT_PLANNER_ALLOWED_SCOPES;
  if(!value || value.length>2048)return null;
  const scopes=value.split(',').map(scope=>scope.trim());
  const scopePattern=/^[A-Za-z][A-Za-z0-9_-]{0,63}:[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  if(!scopes.length||scopes.length>32||scopes.some(scope=>!scopePattern.test(scope))||
     new Set(scopes).size!==scopes.length)return null;
  const rawSteps=env.AGENT_PLANNER_MAX_STEPS;
  if(rawSteps!==undefined && !/^[1-8]$/.test(rawSteps))return null;
  return {brandId,allowedScopes:scopes,allowWrites:env.AGENT_PLANNER_ALLOW_WRITES==='1',maxSteps:rawSteps?Number(rawSteps):5};
}

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Only one narrow, non-sensitive question can be sent without provider evidence. */
function safeClarification(value:string):boolean {
  const question=value.trim();
  if(question.length<3||question.length>260||!/[?؟]$/.test(question))return false;
  if((question.match(/[?؟]/g)??[]).length!==1)return false;
  return !/(password|passcode|otp|pin|cvv|secret|token|verification code|كلمة\s*(?:ال)?سر|رمز\s*(?:التحقق|التأكيد)|بطاقة)/iu.test(question);
}

export class InboundPlanner {
  private readonly db:Database;
  constructor(private readonly deps:{
    planner:Pick<BoundedPlanner,'run'>;
    registry:Pick<ToolRegistry,'list'>;
    policy:InboundPlannerPolicy;
    dbPath:string;
  }){
    if(deps.dbPath!==':memory:')mkdirSync(dirname(deps.dbPath),{recursive:true});
    this.db=new Database(deps.dbPath);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA busy_timeout = 5000');
    this.db.run(`CREATE TABLE IF NOT EXISTS inbound_planner_turns (
      brand_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL, state TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(brand_id,chat_id,message_id)
    )`);
  }

  /** Returns null for normal moderator fallback, or a concrete autopilot decision. */
  async process(message:ChatMessage):Promise<DecisionResult|null>{
    const {policy,registry,planner}=this.deps;
    if(!message.id?.trim()||message.id.length>256||!message.chatId?.trim()||
       message.chatId.length>256||!message.text?.trim()||message.text.length>2000||
       message.isFromMe||message.type!=='text'||message.chatId.endsWith('@g.us'))return null;

    // Evaluate registered capabilities anew on each turn; dynamic connectors can join later.
    const connected=registry.list(policy.brandId);
    const available=new Set(connected.map(tool=>tool.scope));
    if(policy.allowedScopes.some(scope=>!available.has(scope)))return null;
    const callable=connected.some(tool=>policy.allowedScopes.includes(tool.scope)&&
      (tool.kind==='read'||policy.allowWrites));
    if(!callable)return null;

    const workflowId='wa-'+digest(JSON.stringify([policy.brandId,message.chatId,message.id]));
    const claimed=this.db.transaction(()=>{
      const now=Date.now();
      const result=this.db.query(`INSERT OR IGNORE INTO inbound_planner_turns
        (brand_id,chat_id,message_id,workflow_id,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(policy.brandId,message.chatId,message.id,workflowId,'processing',now,now);
      return result.changes===1;
    })();
    if(!claimed)return this.ignore('Previously received WhatsApp message; replay suppressed');

    const setState=(state:string)=>this.db.query(`UPDATE inbound_planner_turns
      SET state=?,updated_at=? WHERE brand_id=? AND chat_id=? AND message_id=?`)
      .run(state,Date.now(),policy.brandId,message.chatId,message.id);
    let outcome:PlannerOutcome;
    try{
      const goal:PlannerGoal={
        brandId:policy.brandId,contactId:message.chatId,goal:message.text,
        workflowId,allowedScopes:[...policy.allowedScopes],
        allowWrites:policy.allowWrites,maxSteps:policy.maxSteps
      };
      outcome=await planner.run(goal);
    }catch{
      setState('failed_recoverable');
      return null;
    }

    setState(outcome.status);
    if(outcome.status==='needs_customer_detail'&&outcome.evidence.length===0&&safeClarification(outcome.reply))
      return this.reply(outcome.reply,'One bounded question needed before any external action');
    if(outcome.status==='waiting_provider'){
      return this.reply(outcome.reply,'Provider state remains unverified; no write retry');
    }
    if(outcome.status!=='completed'||!outcome.reply.trim()||outcome.evidence.length===0)return null;
    // A model assertion alone is never sufficient evidence of a successful external write.
    const receiptsComplete=outcome.evidence.every(item=>item.kind!=='write'||
      (typeof item.providerReceiptId==='string'&&item.providerReceiptId.trim().length>0));
    if(!receiptsComplete)return null;
    return this.reply(outcome.reply,'Verified provider evidence from the brand-scoped planner');
  }
  close(){this.db.close();}
  private reply(text:string,reasoning:string):DecisionResult{
    return {decision:{action:'reply',intent:'general_faq',replyText:text,reasoning,
      confidence:1,simulatedDelayMs:0,sendAsVoiceNote:false},shouldSendImmediately:true};
  }
  private ignore(reasoning:string):DecisionResult{
    return {decision:{action:'ignore',intent:'duplicate',reasoning,
      confidence:1,simulatedDelayMs:0},shouldSendImmediately:false};
  }
}

/** Integration entrypoint: pass the result as AgentTurnCoordinator({planner: ...}). */
export function createInboundPlanner({planner,registry,dataDir,brandId,env=process.env}:{
  planner?:Pick<BoundedPlanner,'run'>;
  registry:Pick<ToolRegistry,'list'>;
  dataDir:string;
  brandId?:string;
  env?:Env;
}):InboundPlanner|undefined {
  const policy=resolveInboundPlannerPolicy({env,brandId});
  if(!planner||!policy)return undefined;
  return new InboundPlanner({planner,registry,policy,
    dbPath:dataDir===':memory:'?':memory:':join(dataDir,'inbound-planner.sqlite')});
}
