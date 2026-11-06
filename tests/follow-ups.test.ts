import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FollowUpStore} from '../src/agent/follow-ups';

test('E07 consent, approved template, quiet hours and opt-out gate proactive contact',()=>{
 const store=new FollowUpStore({dbPath:':memory:'});
 const due=Date.UTC(2026,10,6,12,0);
 const one=store.schedule({brandId:'a',contactId:'c',reason:'quote_followup',dueAt:due,sourceWorkflowId:'w',consentRef:'form-1',templateRef:'approved-1'});
 const two=store.schedule({brandId:'a',contactId:'c',reason:'quote_followup',dueAt:due,sourceWorkflowId:'w',consentRef:'form-1',templateRef:'approved-1'});
 expect(two).toBe(one);
 const base={now:due,channel:'meta-cloud' as const,optIn:true,templateApproved:true,timeZone:'UTC',quietHours:{from:22,to:9}};
 expect(store.evaluate(one,{...base,optIn:false}).decision).toBe('skip');
 expect(store.evaluate(one,{...base,templateApproved:false}).decision).toBe('skip');
 expect(store.evaluate(one,{...base,channel:'baileys'}).decision).toBe('skip');
 expect(store.evaluate(one,{...base,now:Date.UTC(2026,10,6,23,0)}).decision).toBe('defer');
 expect(store.evaluate(one,base).decision).toBe('send');
 store.optOut('a','c');
 expect(store.evaluate(one,base).decision).toBe('skip');
 store.close();
});

test('restart during outbound dispatch produces uncertain state with zero repeat sends',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'agent-fu-'));
 try {
  const dbPath=join(directory,'followups.sqlite');
  const one=new FollowUpStore({dbPath});
  const due=Date.UTC(2026,10,6,12,0);
  const id=one.schedule({brandId:'a',contactId:'c',reason:'delivery_delay',dueAt:due,sourceWorkflowId:'w',consentRef:'form',templateRef:'tpl'});
  let calls=0;
  const context={now:due,channel:'meta-cloud' as const,optIn:true,templateApproved:true,timeZone:'UTC',quietHours:{from:22,to:9}};
  const result=await one.dispatch(id,context,async()=>{calls++;throw Error('network timeout')});
  expect(result.status).toBe('uncertain');
  one.close();
  const restarted=new FollowUpStore({dbPath});
  const retry=await restarted.dispatch(id,context,async()=>{calls++;return 'receipt2'});
  expect(retry.status).toBe('uncertain');
  expect(calls).toBe(1);
  restarted.close();
 } finally {rmSync(directory,{recursive:true,force:true});}
});

test('reply cancels scheduled nudges; unrelated brand remains independent',()=>{
 const store=new FollowUpStore({dbPath:':memory:'});
 const now=Date.now();
 const a=store.schedule({brandId:'a',contactId:'same',reason:'quote_followup',dueAt:now,sourceWorkflowId:'w1',consentRef:'x',templateRef:'t'});
 const b=store.schedule({brandId:'b',contactId:'same',reason:'quote_followup',dueAt:now,sourceWorkflowId:'w2',consentRef:'x',templateRef:'t'});
 store.onCustomerReply('a','same');
 expect(store.get(a)?.status).toBe('cancelled');
 expect(store.get(b)?.status).toBe('scheduled');
 store.close();
});
