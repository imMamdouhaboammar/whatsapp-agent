import type {Hono} from 'hono';
import {createHash,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {BrandKnowledgeStore} from './brand-knowledge';
import {ActionJournal,ToolRegistry} from './tools';
import {GoogleSheetsInventory} from './sheets-inventory';
import {ConnectorSettings} from './connector-settings';
import {AutonomousOperator} from './autonomous-operator';
import {BoundedPlanner} from './bounded-planner';
import {WebScout} from './web-scout';
import type {GeminiClient} from '../ai/gemini-client';
import {CustomerContextStore} from './customer-context';
import {FollowUpStore} from './follow-ups';
import {QualityLoop} from './quality-loop';
import {DocumentExtractionService} from './media-service';

const validBrand=(id:string)=>/^[A-Za-z0-9_-]{1,64}$/.test(id);
const digest=(s:string)=>createHash('sha256').update(s).digest();
function isValidBase64(str: string): boolean {
  if (!str || str.length % 4 !== 0 || str.length > 21 * 1024 * 1024) return false;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (
      !(ch >= 65 && ch <= 90) &&
      !(ch >= 97 && ch <= 122) &&
      !(ch >= 48 && ch <= 57) &&
      ch !== 43 && ch !== 47 && ch !== 61
    ) {
      return false;
    }
  }
  return true;
}
export function createCapabilities(dataDir:string,model?:Pick<GeminiClient,'generateContent'>) {
 const path=(filename:string)=>dataDir===':memory:' ? ':memory:' : join(dataDir,filename);
 const knowledge=new BrandKnowledgeStore({dbPath:path('agent-knowledge.sqlite')});
 const journal=new ActionJournal({dbPath:path('agent-actions.sqlite')});
 const connectors=new ConnectorSettings({dbPath:path('agent-connectors.sqlite')});
 const customers=new CustomerContextStore({dbPath:path('agent-customer.sqlite')});
 const followups=new FollowUpStore({dbPath:path('agent-followups.sqlite')});
 const quality=new QualityLoop({dbPath:path('agent-quality.sqlite')});
 const documents=new DocumentExtractionService();
 const registry=new ToolRegistry(journal);
 const webScout=model ? new WebScout(model) : undefined;
 const operator=new AutonomousOperator({knowledge,journal,registry,webScout});
 const planner=model ? new BoundedPlanner({model,registry,journal}) : undefined;
 const registerSheet=(brandId:string,sheetId:string,gid?:string)=>{
  const provider=new GoogleSheetsInventory({sheetId,gid});
  registry.register(brandId,{name:'inventory.lookup',kind:'read',scope:'inventory:read',
   description:'Look up available inventory by exact product SKU',
   parameters:{type:'OBJECT',properties:{sku:{type:'STRING'}},required:['sku']},
   validate:(v):v is {sku:string}=>typeof v==='object' && v!==null && typeof (v as any).sku==='string' && (v as any).sku.length<129,
   execute:async({sku})=>provider.lookup(sku)
  });
 };
 for(const item of connectors.listSheets())registerSheet(item.brandId,item.sheetId,item.gid);
 return {knowledge,journal,connectors,customers,followups,quality,documents,registry,operator,planner,webScout,registerSheet,
  close:()=>{knowledge.close();journal.close();connectors.close();customers.close();followups.close();quality.close();}
 };
}
export type CapabilityEngine=ReturnType<typeof createCapabilities>;

export function registerCapabilityRoutes(app:Hono, capabilities:CapabilityEngine, token:string) {
 const auth=async(c:any,next:()=>Promise<void>)=>{
  if(!token)return c.json({error:'Owner token is not configured'},503);
  const provided=c.req.header('x-agent-owner-token')??'';
  if(!provided || !timingSafeEqual(digest(provided),digest(token)))return c.json({error:'Unauthorized'},401);
  await next();
 };
 app.use('/api/brands/*',auth);
 app.use('/api/agent/*',auth);

 app.get('/api/agent/status',(c)=>c.json({available:true,configuredTools:capabilities.registry.list('default').length}));

 // Owner-authenticated planner runtime. Callers are trusted owners, never inbound WhatsApp contacts.
 app.post('/api/agent/plan',async(c)=>{
  const body=await c.req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body) ||
   typeof body.brandId!=='string'||!validBrand(body.brandId)||
   typeof body.contactId!=='string'||!body.contactId.trim()||body.contactId.length>128||[...body.contactId].some((ch:string)=>ch.charCodeAt(0)<32)||
   typeof body.goal!=='string'||!body.goal.trim()||body.goal.length>2000||
   !Array.isArray(body.allowedScopes)||body.allowedScopes.length>64||
   body.allowedScopes.some((s:unknown)=>typeof s!=='string'||!s.trim()||s.length>128)||
   (body.workflowId!==undefined&&(typeof body.workflowId!=='string'||! /^[A-Za-z0-9:_-]{1,128}$/.test(body.workflowId)))||
   (body.maxSteps!==undefined&&(!Number.isInteger(body.maxSteps)||body.maxSteps<1||body.maxSteps>8))||
   (body.allowWrites!==undefined&&typeof body.allowWrites!=='boolean'))
    return c.json({error:'Invalid planner request'},400);
  if(!capabilities.planner)return c.json({error:'Planner model is not configured'},503);
  try {
   return c.json(await capabilities.planner.run({brandId:body.brandId,contactId:body.contactId,goal:body.goal,
    workflowId:body.workflowId,allowedScopes:body.allowedScopes,allowWrites:body.allowWrites===true,maxSteps:body.maxSteps}));
  }catch(err){
   if(err instanceof Error&&/Workflow identity conflict|Invalid workflow identity/.test(err.message))
    return c.json({error:'Workflow identity conflict'},409);
   return c.json({error:'Planner unavailable'},503);
  }
 });

 app.get('/api/brands/:brandId/sources',(c)=>{
  const brandId=c.req.param('brandId');if(!validBrand(brandId))return c.json({error:'Invalid brand'},400);
  return c.json({sources:capabilities.knowledge.listSources(brandId)});
 });
 app.post('/api/brands/:brandId/documents/ingest',async(c)=>{
  const brandId=c.req.param('brandId');
  const body=await c.req.json().catch(()=>({}));
  const supported=['text/plain','text/markdown','text/csv','text/html','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'];
  if(!validBrand(brandId) || !supported.includes(body.mimeType) || typeof body.locator!=='string' || !body.locator.trim() || body.locator.length>256 || !['official','working','external'].includes(body.authority) || !isValidBase64(body.base64))return c.json({error:'Invalid document request'},400);
  try{
   const extracted=await capabilities.documents.extract({brandId,messageId:'owner:'+body.locator,mimeType:body.mimeType,data:Buffer.from(body.base64,'base64')});
   const normalized=capabilities.documents.toKnowledgeContent(extracted);
   const version=await capabilities.knowledge.ingest({brandId,type:normalized.type,locator:body.locator,content:normalized.content,authority:body.authority});
   return c.json({...version,preview:extracted.sections.slice(0,10),sectionCount:extracted.sections.length},201);
  }catch(err){return c.json({error:err instanceof Error?err.message:'Document extraction failed'},422);}
 });
 app.post('/api/brands/:brandId/sources',async(c)=>{
  const brandId=c.req.param('brandId');if(!validBrand(brandId))return c.json({error:'Invalid brand'},400);
  const body=await c.req.json().catch(()=>({}));
  if(!body || typeof body!=='object' || typeof body.locator!=='string' || typeof body.content!=='string' || !['text','faq','csv'].includes(body.type) || !['official','working','external'].includes(body.authority)) return c.json({error:'Invalid source'},400);
  try {
   const result=await capabilities.knowledge.ingest({brandId,type:body.type,locator:body.locator,content:body.content,authority:body.authority,locale:body.locale});
   return c.json(result,201);
  }catch(err){return c.json({error:err instanceof Error?err.message:'Invalid source'},400);}
 });
 app.get('/api/brands/:brandId/conflicts',(c)=>{
  const brandId=c.req.param('brandId');
  if(!validBrand(brandId))return c.json({error:'Invalid brand'},400);
  return c.json({conflicts:capabilities.knowledge.listConflicts(brandId)});
 });
 app.post('/api/brands/:brandId/retrieve',async(c)=>{
  const brandId=c.req.param('brandId');if(!validBrand(brandId))return c.json({error:'Invalid brand'},400);
  const body=await c.req.json().catch(()=>({}));
  if(typeof body.question!=='string' || body.question.length>2000)return c.json({error:'Invalid query'},400);
  return c.json(await capabilities.knowledge.retrieve({brandId,question:body.question,limit:body.limit}));
 });
 app.post('/api/brands/:brandId/web/search',async(c)=>{
  const brandId=c.req.param('brandId');if(!validBrand(brandId))return c.json({error:'Invalid brand'},400);
  if(!capabilities.webScout)return c.json({error:'Grounded search not configured'},503);
  const body=await c.req.json().catch(()=>({}));
  if(typeof body.question!=='string' || !body.question.trim() || body.question.length>2000 || (body.freshnessNeed && !['current','recent','stable'].includes(body.freshnessNeed)))return c.json({error:'Invalid search request'},400);
  try{return c.json(await capabilities.webScout.search({question:body.question,geography:body.geography,freshnessNeed:body.freshnessNeed??'current',maxSources:body.maxSources}));}
  catch{return c.json({error:'Grounded search unavailable'},503);}
 });
 app.get('/api/brands/:brandId/tools',(c)=>{
  const brandId=c.req.param('brandId');if(!validBrand(brandId))return c.json({error:'Invalid brand'},400);
  return c.json({tools:capabilities.registry.list(brandId)});
 });
 app.post('/api/brands/:brandId/connectors/google-sheets',async(c)=>{
  const brandId=c.req.param('brandId');if(!validBrand(brandId))return c.json({error:'Invalid brand'},400);
  const body=await c.req.json().catch(()=>({}));
  if(typeof body.sheetId!=='string' || (body.gid!==undefined && typeof body.gid!=='string'))return c.json({error:'Invalid sheet'},400);
  try{
   new GoogleSheetsInventory({sheetId:body.sheetId,gid:body.gid});
   capabilities.connectors.setSheet(brandId,body.sheetId,body.gid);
   capabilities.registerSheet(brandId,body.sheetId,body.gid);
   return c.json({connected:true,brandId,tool:'inventory.lookup'});
  }catch{return c.json({error:'Invalid sheet configuration'},400);}
 });

 // A07 customer context: lineage and brand/contact isolation.
 app.get('/api/brands/:brandId/customers/:contactId/context',(c)=>{
  const {brandId,contactId}=c.req.param();
  if(!validBrand(brandId)||!contactId||contactId.length>128)return c.json({error:'Invalid identity'},400);
  return c.json(capabilities.customers.getContext({brandId,contactId}));
 });
 app.post('/api/brands/:brandId/customers/:contactId/facts',async(c)=>{
  const {brandId,contactId}=c.req.param();
  const body=await c.req.json().catch(()=>({}));
  if(!validBrand(brandId)||!contactId||contactId.length>128||!body||['key','value','sourceMessageId'].some(f=>typeof body[f]!=='string'||!body[f].trim()||body[f].length>2000))return c.json({error:'Invalid fact'},400);
  try{capabilities.customers.recordFact({brandId,contactId,...body});return c.json({recorded:true},201);}
  catch{return c.json({error:'Invalid fact'},400);}
 });
 app.post('/api/brands/:brandId/customers/:contactId/cases',async(c)=>{
  const {brandId,contactId}=c.req.param();
  const body=await c.req.json().catch(()=>({}));
  if(!validBrand(brandId)||!contactId||contactId.length>128||typeof body.intent!=='string'||!body.intent.trim()||body.intent.length>200||typeof body.sourceMessageId!=='string'||!body.sourceMessageId.trim()||body.sourceMessageId.length>128)return c.json({error:'Invalid case'},400);
  return c.json({caseId:capabilities.customers.openCase({brandId,contactId,intent:body.intent,sourceMessageId:body.sourceMessageId})},201);
 });
 app.post('/api/brands/:brandId/customers/:contactId/cases/:caseId/close',async(c)=>{
  const {brandId,contactId,caseId}=c.req.param();
  const body=await c.req.json().catch(()=>({}));
  if(!validBrand(brandId)||!contactId||!caseId||typeof body.providerReceiptId!=='string'||!body.providerReceiptId.trim()||body.providerReceiptId.length>128)return c.json({error:'Verified provider receipt required'},400);
  try{capabilities.customers.closeCase({brandId,contactId,caseId,providerReceiptId:body.providerReceiptId});return c.json({closed:true});}
  catch{return c.json({error:'Case not found or unverified'},409);}
 });
 app.post('/api/brands/:brandId/customers/:contactId/optout',(c)=>{
  const {brandId,contactId}=c.req.param();
  if(!validBrand(brandId)||!contactId||contactId.length>128)return c.json({error:'Invalid identity'},400);
  capabilities.followups.optOut(brandId,contactId);
  return c.json({optedOut:true});
 });
 // A08: schedule is separate from sending; only official Cloud API eligibility can dispatch.
 app.post('/api/brands/:brandId/followups',async(c)=>{
  const brandId=c.req.param('brandId');
  const body=await c.req.json().catch(()=>({}));
  if(!validBrand(brandId)||typeof body.contactId!=='string'||!body.contactId.trim()||body.contactId.length>128||typeof body.reason!=='string'||body.reason.length>200||typeof body.sourceWorkflowId!=='string'||body.sourceWorkflowId.length>128||typeof body.dueAt!=='number'||!Number.isFinite(body.dueAt))return c.json({error:'Invalid followup'},400);
  try{
   const triggerId=capabilities.followups.schedule({brandId,contactId:body.contactId,reason:body.reason,dueAt:body.dueAt,sourceWorkflowId:body.sourceWorkflowId,consentRef:body.consentRef,templateRef:body.templateRef});
   return c.json({triggerId},201);
  }catch{return c.json({error:'Invalid followup'},400);}
 });
 app.get('/api/brands/:brandId/followups/:id',(c)=>{
  const brandId=c.req.param('brandId');
  if(!validBrand(brandId))return c.json({error:'Invalid brand'},400);
  const trigger=capabilities.followups.get(c.req.param('id'));
  if(!trigger||trigger.brandId!==brandId)return c.json({error:'Not found'},404);
  return c.json(trigger);
 });
 // A10: aggregate offline evaluation, no auto-promotion of unreviewed brand policy changes.
 app.post('/api/brands/:brandId/evaluations',async(c)=>{
  const brandId=c.req.param('brandId');
  const body=await c.req.json().catch(()=>({}));
  if(!validBrand(brandId)||typeof body.scenarioId!=='string'||body.scenarioId.length>128||typeof body.intent!=='string'||!body.intent||body.intent.length>128||typeof body.question!=='string'||body.question.length>2000||typeof body.resolved!=='boolean'||typeof body.supported!=='boolean')return c.json({error:'Invalid evaluation'},400);
  try{capabilities.quality.record({brandId,scenarioId:body.scenarioId,intent:body.intent,question:body.question,resolved:body.resolved,supported:body.supported,missingSource:body.missingSource});return c.json({recorded:true},201);}
  catch{return c.json({error:'Invalid evaluation'},400);}
 });
 app.get('/api/brands/:brandId/quality',(c)=>{
  const brandId=c.req.param('brandId');
  if(!validBrand(brandId))return c.json({error:'Invalid brand'},400);
  return c.json({scorecard:capabilities.quality.scorecard(brandId),gaps:capabilities.quality.gaps(brandId)});
 });

 app.post('/api/agent/resolve',async(c)=>{
  const body=await c.req.json().catch(()=>({}));
  if(!validBrand(body.brandId??'') || typeof body.contactId!=='string' || body.contactId.length>128 || typeof body.text!=='string' || body.text.length>2000 || !body.text.trim())return c.json({error:'Invalid request'},400);
  try{
   return c.json(await capabilities.operator.resolve({brandId:body.brandId,contactId:body.contactId,text:body.text}));
  }catch{return c.json({error:'Agent resolution failed'},500);}
 });
}
