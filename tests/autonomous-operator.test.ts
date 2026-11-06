import {test,expect} from 'bun:test';
import {BrandKnowledgeStore} from '../src/agent/brand-knowledge';
import {ActionJournal,ToolRegistry} from '../src/agent/tools';
import {AutonomousOperator} from '../src/agent/autonomous-operator';

test('E01/E10 agent answers Arabic stock request only from authorized provider with evidence',async()=>{
 const knowledge=new BrandKnowledgeStore({dbPath:':memory:'});
 const journal=new ActionJournal({dbPath:':memory:'});
 const registry=new ToolRegistry(journal);
 registry.register('brand',{name:'inventory.lookup',kind:'read',scope:'inventory:read',validate:(v):v is {sku:string}=>typeof (v as any)?.sku==='string',execute:async ({sku})=>({sku,stock:4,price:120,currency:'SAR',updatedAt:'2026-11-06'})});
 const operator=new AutonomousOperator({knowledge,registry,journal});
 const result=await operator.resolve({brandId:'brand',contactId:'customer',text:'هل SKU-42 موجود وبكام؟'});
 expect(result.status).toBe('answered');
 expect(result.reply).toContain('SKU-42');
 expect(result.reply).toContain('4');
 expect(result.reply).toContain('120');
 expect(result.evidence.some(e=>e.kind==='provider')).toBe(true);
 expect((await operator.resolve({brandId:'other',contactId:'customer',text:'هل SKU-42 موجود؟'})).status).toBe('clarification');
 knowledge.close();journal.close();
});

test('E05 public current question uses dated web evidence rather than inventing a current answer',async()=>{
 const knowledge=new BrandKnowledgeStore({dbPath:':memory:'});
 const journal=new ActionJournal({dbPath:':memory:'});
 const registry=new ToolRegistry(journal);
 const calls:string[]=[];
 const scout={search:async(input:any)=>{calls.push(input.question);return {status:'grounded',answer:'تحديث رسمي',sources:[{url:'https://www.spa.gov.sa/test',observedAt:1700000000000,title:'مصدر رسمي'}]};}};
 const operator=new AutonomousOperator({knowledge,registry,journal,webScout:scout as any});
 const result=await operator.resolve({brandId:'brand',contactId:'customer',text:'ما آخر أخبار النقل اليوم؟'});
 expect(result.status).toBe('answered');
 expect(result.evidence.some(e=>e.kind==='web' && e.source==='https://www.spa.gov.sa/test')).toBe(true);
 expect(result.reply).toContain('https://www.spa.gov.sa/test');
 expect(calls).toHaveLength(1);
 knowledge.close();journal.close();
});

test('conflicting active return policies do not result in an invented business promise',async()=>{
 const knowledge=new BrandKnowledgeStore({dbPath:':memory:'});
 const journal=new ActionJournal({dbPath:':memory:'});
 const registry=new ToolRegistry(journal);
 await knowledge.ingest({brandId:'brand',type:'faq',locator:'policy-old',content:'سياسة الإرجاع خلال 7 أيام',authority:'working'});
 await knowledge.ingest({brandId:'brand',type:'faq',locator:'policy-new',content:'سياسة الإرجاع خلال 14 يوم',authority:'official'});
 const result=await new AutonomousOperator({knowledge,registry,journal}).resolve({brandId:'brand',contactId:'c',text:'كم مدة الإرجاع؟'});
 expect(result.status).toBe('clarification');
 expect(result.reply).toContain('تعارض');
 expect(result.reply).not.toContain('14 يوم');
 knowledge.close();journal.close();
});

test('unknown sku does not invent stock/price or trigger a write',async()=>{
 const knowledge=new BrandKnowledgeStore({dbPath:':memory:'});
 const journal=new ActionJournal({dbPath:':memory:'});
 const registry=new ToolRegistry(journal);
 const operator=new AutonomousOperator({knowledge,registry,journal});
 const result=await operator.resolve({brandId:'a',contactId:'b',text:'ممكن تقولي السعر والمخزون؟'});
 expect(result.status).toBe('clarification');
 expect(result.reply).not.toMatch(/\b\d+\s*(SAR|ريال)\b/);
 knowledge.close();journal.close();
});
