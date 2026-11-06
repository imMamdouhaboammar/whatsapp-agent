import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionJournal, ToolRegistry } from '../src/agent/tools';

test('write tool executes at most once for repeated idempotency key', async () => {
  const journal = new ActionJournal({dbPath: ':memory:'});
  const registry = new ToolRegistry(journal);
  let calls = 0;
  registry.register('brand-a',{name:'ticket.create',kind:'write',scope:'tickets:write',validate:(v):v is {subject:string}=>typeof v === 'object' && !!v && typeof (v as any).subject === 'string',execute:async () => {calls++;return {receipt:'ticket-1'};}});
  const args = {brandId:'brand-a',toolName:'ticket.create',workflowId:'w-1',idempotencyKey:'ticket:once',input:{subject:'Broken'}};
  const a = await registry.run(args);
  const b = await registry.run(args);
  expect(a.status).toBe('confirmed');
  expect(b.status).toBe('confirmed');
  expect(a.output).toEqual(b.output);
  expect(calls).toBe(1);
  await expect(registry.run({...args,input:{subject:'Different'}})).rejects.toThrow();
  journal.close();
});

test('write timeout is uncertain after restart and never repeats without reconcile', async () => {
  const directory = mkdtempSync(join(tmpdir(),'agent-journal-'));
  const dbPath = join(directory,'journal.sqlite');
  try {
    const first = new ActionJournal({dbPath});
    const registry = new ToolRegistry(first);
    let writes=0;
    registry.register('a',{name:'booking.create',kind:'write',scope:'booking:write',validate:(_):_ is object=>true,execute:async()=>{writes++;throw new Error('network timeout')}});
    const args={brandId:'a',toolName:'booking.create',workflowId:'w',idempotencyKey:'same',input:{slot:'10:00'}};
    expect((await registry.run(args)).status).toBe('uncertain');
    first.close();
    const second=new ActionJournal({dbPath});
    const next=new ToolRegistry(second);
    next.register('a',{name:'booking.create',kind:'write',scope:'booking:write',validate:(_):_ is object=>true,execute:async()=>{writes++;return {confirmed:true}}});
    expect((await next.run(args)).status).toBe('uncertain');
    expect(writes).toBe(1);
    second.close();
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('registry never exposes unauthorized tools or tools from another tenant', async () => {
 const journal=new ActionJournal({dbPath:':memory:'});
 const registry=new ToolRegistry(journal);
 registry.register('a',{name:'refund',kind:'write',scope:'refund:write',validate:(_):_ is object=>true,execute:async()=>({})});
 expect(registry.list('b')).toHaveLength(0);
 await expect(registry.run({brandId:'b',toolName:'refund',workflowId:'w',idempotencyKey:'k',input:{}})).rejects.toThrow();
 journal.close();
});
