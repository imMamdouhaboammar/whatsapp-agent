import {test,expect} from 'bun:test';
import {createFableWhatsAppAgent} from '../src/index';

test('capability APIs protect brand data and resolve an inventory goal without sending WhatsApp',async()=>{
 const agent=await createFableWhatsAppAgent({dataDir:':memory:',autoConnect:false,capabilityToken:'test-owner-token'});
 try{
  const noAuth=await agent.app.request('/api/brands/brand-a/sources');
  expect(noAuth.status).toBe(401);
  const headers={'content-type':'application/json','x-agent-owner-token':'test-owner-token'};
  const create=await agent.app.request('/api/brands/brand-a/sources',{method:'POST',headers,body:JSON.stringify({type:'faq',locator:'shipping',authority:'official',content:'الشحن خلال يومين'})});
  expect(create.status).toBe(201);
  expect(await create.json()).toHaveProperty('versionId', expect.stringMatching(/./));
  const lookup=await agent.app.request('/api/brands/brand-a/retrieve',{method:'POST',headers,body:JSON.stringify({question:'الشحن'})});
  expect(lookup.status).toBe(200);
  expect(await lookup.json()).toHaveProperty('evidence.0.text', expect.stringContaining('يومين'));
  const other=await agent.app.request('/api/brands/brand-b/retrieve',{method:'POST',headers,body:JSON.stringify({question:'الشحن'})});
  expect(await other.json()).toHaveProperty('evidence', []);
  const goal=await agent.app.request('/api/agent/resolve',{method:'POST',headers,body:JSON.stringify({brandId:'brand-a',contactId:'customer',text:'الشحن'})});
  expect(await goal.json()).toMatchObject({status:'answered',reply:expect.stringContaining('يومين')});
  const bad=await agent.app.request('/api/brands/brand-a/sources',{method:'POST',headers,body:JSON.stringify({type:'text',locator:'oversize',authority:'official',content:'x'.repeat(1024*1024+1)})});
  expect(bad.status).toBe(400);
 } finally {
  agent.capabilities.close();
  agent.memoryStore.close();
 }
});
test('A03 external facts via protected API expose grounded public URL and reject unauthorized calls',async()=>{
 const model={generateContent:async()=>({text:'تحديث اليوم',groundingMetadata:{groundingChunks:[{web:{uri:'https://www.spa.gov.sa/latest',title:'SPA'}}]}})};
 const agent=await createFableWhatsAppAgent({dataDir:':memory:',autoConnect:false,capabilityToken:'owner',capabilityModel:model});
 try {
  expect((await agent.app.request('/api/brands/test/web/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'ما آخر الأخبار؟'})})).status).toBe(401);
  const r=await agent.app.request('/api/brands/test/web/search',{method:'POST',headers:{'content-type':'application/json','x-agent-owner-token':'owner'},body:JSON.stringify({question:'ما آخر الأخبار؟'})});
  expect(r.status).toBe(200);
  const body: unknown = await r.json();
  expect(body).toHaveProperty('status','grounded');
  expect(body).toHaveProperty('sources.0.url','https://www.spa.gov.sa/latest');
 }finally{agent.capabilities.close();agent.memoryStore.close();}
});

test('A01/A04 owner uploads CSV document; source is versioned, evidenced and brand-isolated',async()=>{
 const agent=await createFableWhatsAppAgent({dataDir:':memory:',autoConnect:false,capabilityToken:'owner'});
 const headers={'content-type':'application/json','x-agent-owner-token':'owner'};
 try{
  const path='/api/brands/store/documents/ingest';
  const payload={mimeType:'text/csv',locator:'catalog.csv',authority:'official',base64:Buffer.from('SKU,Price\\nSKU-42,120'.replace('\\n','\n')).toString('base64')};
  const missing=await agent.app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  expect(missing.status).toBe(401);
  const first=await agent.app.request(path,{method:'POST',headers,body:JSON.stringify(payload)});
  expect(first.status).toBe(201);
  const result: unknown = await first.json();
  expect(result).toHaveProperty('sourceId',expect.stringMatching(/./));
  expect(result).toHaveProperty('preview',expect.arrayContaining([expect.objectContaining({location:'row:2'})]));
  const repeated=await agent.app.request(path,{method:'POST',headers,body:JSON.stringify(payload)});
  expect(await repeated.json()).toHaveProperty('changed',false);
  expect((await agent.capabilities.knowledge.retrieve({brandId:'other',question:'SKU-42'})).evidence).toHaveLength(0);
 }finally{agent.capabilities.close();agent.memoryStore.close();}
});

test('owner can review exact conflicting active policy sources without disclosing to another tenant',async()=>{
 const agent=await createFableWhatsAppAgent({dataDir:':memory:',autoConnect:false,capabilityToken:'owner'});
 const headers={'x-agent-owner-token':'owner'};
 try{
  const k=agent.capabilities.knowledge;
  await k.ingest({brandId:'alpha',type:'faq',locator:'old',authority:'working',content:'الإرجاع 7 أيام'});
  await k.ingest({brandId:'alpha',type:'faq',locator:'new',authority:'official',content:'الإرجاع 14 يوم'});
  const res=await agent.app.request('/api/brands/alpha/conflicts',{headers});
  expect(res.status).toBe(200);
  expect(await res.json()).toHaveProperty('conflicts.0.values',[7,14]);
  const other=await agent.app.request('/api/brands/beta/conflicts',{headers});
  expect(await other.json()).toHaveProperty('conflicts', []);
 }finally{agent.capabilities.close();agent.memoryStore.close();}
});

test('capability mutations stay disabled without an owner token',async()=>{
 const agent=await createFableWhatsAppAgent({dataDir:':memory:',autoConnect:false,capabilityToken:''});
 try{
  const r=await agent.app.request('/api/brands/a/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'text',locator:'x',authority:'official',content:'p'})});
  expect(r.status).toBe(503);
 } finally {agent.capabilities.close();agent.memoryStore.close();}
});
