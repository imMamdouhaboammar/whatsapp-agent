import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({root,configFile:false,server:{middlewareMode:true},appType:'custom'});
after(async()=>{await vite.close()});
const {LocaleProvider}=await vite.ssrLoadModule('/src/i18n.tsx');
const {BrandBrainPage}=await vite.ssrLoadModule('/src/components/BrandBrainPage.tsx');
const {brandBrainApi}=await vite.ssrLoadModule('/src/api/client.ts');
const render=lang=>renderToStaticMarkup(React.createElement(LocaleProvider,{initial:lang},React.createElement(BrandBrainPage,{onClose:()=>{}})));
await test('Brand Brain supports accessible Arabic RTL and English controls',()=>{
 const ar=render('ar'),en=render('en');
 assert.match(ar,/dir="rtl"/);
 assert.match(ar,/فتح مساحة العلامة/);
 assert.match(ar,/رمز وصول المالك/);
 assert.match(en,/dir="ltr"/);
 assert.match(en,/Open brand workspace/);
 assert.match(en,/Owner access token/);
 assert.match(ar,/type="password"/);
 assert.match(en,/type="password"/);
 assert.doesNotMatch(en,/Save source|Connect sheet|Test without sending/);
 assert.match(en,/Load brand/);
});

await test('Brand Brain loads source, tool and conflict responses atomically and rejects invalid payloads', async () => {
 const original=globalThis.fetch;
 const scope={brandId:'brand-a',token:['fixture','owner'].join('-')};
 const requests=[];
 try {
  globalThis.fetch=async (url,init)=>{
   requests.push({url,init});
   if(url.endsWith('/sources'))return Response.json({sources:[]});
   if(url.endsWith('/tools'))return Response.json({tools:[]});
   return Response.json({conflicts:[]});
  };
  assert.deepEqual(await brandBrainApi.load(scope),{sources:[],tools:[],conflicts:[]});
  assert.equal(requests.length,3);
  for(const {url,init} of requests){
   assert.ok(url.startsWith('/api/brands/brand-a/'));
   assert.equal(new Headers(init.headers).get('x-agent-owner-token'),scope.token);
   assert.equal(init.cache,'no-store');
   assert.ok(!url.includes(scope.token));
  }
  globalThis.fetch=async url=>Response.json(url.endsWith('/sources')?{sources:[{locator:'incomplete'}]}:url.endsWith('/tools')?{tools:[]}:{conflicts:[]});
  await assert.rejects(brandBrainApi.load(scope),/invalid response body/);
 } finally {globalThis.fetch=original;}
});

await test('Brand Brain preserves simulation status and evidence and sends credentials only in a header',async()=>{
 const original=globalThis.fetch;
 const scope={brandId:'brand-b',token:['fixture','owner'].join('-')};
 const reply={status:'clarification',reply:'Please confirm the product',workflowId:'workflow-1',evidence:[{kind:'brand',source:'source-1',versionId:'version-1',observedAt:123}]};
 try{
  globalThis.fetch=async (url,init)=>{
   assert.equal(url,'/api/agent/resolve');
   assert.equal(new Headers(init.headers).get('x-agent-owner-token'),scope.token);
   assert.deepEqual(JSON.parse(init.body),{brandId:'brand-b',contactId:'ui-simulator',text:'Question'});
   return Response.json(reply);
  };
  assert.deepEqual(await brandBrainApi.simulate(scope,'Question'),reply);
  globalThis.fetch=async()=>Response.json({reply:'looks successful'});
  await assert.rejects(brandBrainApi.simulate(scope,'Question'),/invalid response body/);
 }finally{globalThis.fetch=original;}
});
