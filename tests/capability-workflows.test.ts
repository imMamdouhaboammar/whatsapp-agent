import {test,expect} from 'bun:test';
import {createFableWhatsAppAgent} from '../src/index';

test('owner APIs persist customer lineage, guard case completion, followup opt-out and quality scorecard',async()=>{
 const agent=await createFableWhatsAppAgent({dataDir:':memory:',autoConnect:false,capabilityToken:'token'});
 const headers={'content-type':'application/json','x-agent-owner-token':'token'};
 const json=async(url:string,method:string,body?:unknown)=>{
  const res=await agent.app.request(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const payload: unknown = await res.json();
  if (typeof payload !== 'object' || payload === null) throw new Error('Expected a JSON object');
  return {status:res.status,body:payload};
 };
 try{
  const base='/api/brands/store/customers/cust';
  expect((await json(base+'/facts','POST',{key:'shipping_ref',value:'ORD-7',sourceMessageId:'wa-77'})).status).toBe(201);
  const context=await json(base+'/context','GET');
  if (!('facts' in context.body) || !Array.isArray(context.body.facts)) throw new Error('Expected context facts');
  const fact: unknown = context.body.facts[0];
  expect(fact).toMatchObject({sourceMessageId:'wa-77'});
  const otherContext=await json('/api/brands/other/customers/cust/context','GET');
  if (!('facts' in otherContext.body)) throw new Error('Expected other brand context facts');
  expect(otherContext.body.facts).toHaveLength(0);
  const opened=await json(base+'/cases','POST',{intent:'shipment_delay',sourceMessageId:'wa-77'});
  expect(opened.status).toBe(201);
  if (!('caseId' in opened.body) || typeof opened.body.caseId !== 'string') throw new Error('Expected a case ID');
  expect((await json(base+'/cases/'+opened.body.caseId+'/close','POST',{})).status).toBe(400);
  expect((await json(base+'/cases/'+opened.body.caseId+'/close','POST',{providerReceiptId:'carrier-confirmed'})).status).toBe(200);
  const scheduled=await json('/api/brands/store/followups','POST',{contactId:'cust',reason:'delivery',dueAt:Date.now()+60000,sourceWorkflowId:'w',consentRef:'proof',templateRef:'approved-template'});
  expect(scheduled.status).toBe(201);
  if (!('triggerId' in scheduled.body) || typeof scheduled.body.triggerId !== 'string') throw new Error('Expected a trigger ID');
  expect((await json('/api/brands/store/followups/'+scheduled.body.triggerId,'GET')).body).toMatchObject({status:'scheduled'});
  expect((await json('/api/brands/store/customers/cust/optout','POST',{})).status).toBe(200);
  expect((await json('/api/brands/store/followups/'+scheduled.body.triggerId,'GET')).body).toMatchObject({status:'cancelled'});
  expect((await json('/api/brands/store/evaluations','POST',{scenarioId:'E01',intent:'stock',question:'SKU-1',resolved:true,supported:true})).status).toBe(201);
  const quality=await json('/api/brands/store/quality','GET');
  expect(quality.body).toMatchObject({scorecard:{attempts:1}});
  expect((await agent.app.request(base+'/context')).status).toBe(401);
 }finally{agent.capabilities.close();agent.memoryStore.close();}
});
