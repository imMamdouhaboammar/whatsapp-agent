import {describe,test,expect} from 'bun:test';
import {BrandKnowledgeStore} from '../src/agent/brand-knowledge';
import {ActionJournal,ToolRegistry} from '../src/agent/tools';
import { isRecord } from '../src/mcp/records';
import {AutonomousOperator} from '../src/agent/autonomous-operator';

const ARABIC=/\p{Script=Arabic}/u;

function setup(withInventory:boolean,scout?:ConstructorParameters<typeof AutonomousOperator>[0]['webScout']){
 const knowledge=new BrandKnowledgeStore({dbPath:':memory:'});
 const journal=new ActionJournal({dbPath:':memory:'});
 const registry=new ToolRegistry(journal);
 if(withInventory)registry.register('brand',{name:'inventory.lookup',kind:'read',scope:'inventory:read',validate:(v):v is {sku:string}=>isRecord(v) && typeof v.sku==='string',execute:async ({sku})=>({sku,stock:4,price:120,currency:'SAR'})});
 const operator=new AutonomousOperator({knowledge,registry,journal,webScout:scout});
 return {operator,close:()=>{knowledge.close();journal.close();}};
}

describe('reply language follows the customer language',()=>{
 test('English stock question gets an English answer with the same facts',async()=>{
  const {operator,close}=setup(true);
  const r=await operator.resolve({brandId:'brand',contactId:'c',text:'Do you have SKU-42 in stock and how much is it?'});
  expect(r.status).toBe('answered');
  expect(r.reply).toContain('SKU-42');
  expect(r.reply).toContain('has 4 in stock');
  expect(r.reply).toContain('120 SAR');
  expect(r.reply).not.toMatch(ARABIC);
  close();
 });
 test('Arabic stock question still gets an Arabic answer',async()=>{
  const {operator,close}=setup(true);
  const r=await operator.resolve({brandId:'brand',contactId:'c',text:'هل SKU-42 موجود وبكام؟'});
  expect(r.status).toBe('answered');
  expect(r.reply).toMatch(ARABIC);
  expect(r.reply).toContain('SKU-42');
  expect(r.reply).toContain('120 SAR');
  close();
 });
 test('English question with no product detail gets an English clarification',async()=>{
  const {operator,close}=setup(false);
  const r=await operator.resolve({brandId:'brand',contactId:'c',text:'What is the price and stock?'});
  expect(r.status).toBe('clarification');
  expect(r.reply).toMatch(/Could you tell me the product name or order number/);
  expect(r.reply).not.toMatch(ARABIC);
  close();
 });
 test('English unknown-SKU question gets an English clarification',async()=>{
  const {operator,close}=setup(false);
  const r=await operator.resolve({brandId:'brand',contactId:'c',text:'Is SKU-99 available?'});
  expect(r.status).toBe('clarification');
  expect(r.reply).toMatch(/Could you confirm the product name or model/);
  expect(r.reply).not.toMatch(ARABIC);
  close();
 });
 test('English web answer lists sources with an English label',async()=>{
  const scout={search:async()=>({status:'grounded' as const,answer:'Official update',sources:[{url:'https://example.test/a',observedAt:1700000000000,title:'t',publisher:'Example'}]})};
  const {operator,close}=setup(false,scout);
  const r=await operator.resolve({brandId:'brand',contactId:'c',text:'What are the latest transport news today?'});
  expect(r.status).toBe('answered');
  expect(r.reply).toContain('Sources: https://example.test/a');
  expect(r.reply).not.toMatch(ARABIC);
  close();
 });
 test('Arabic letters outside the basic Arabic block still count as Arabic',async()=>{
  const {operator,close}=setup(false);
  const r=await operator.resolve({brandId:'brand',contactId:'c',text:'\uFE8D\uFEDF\uFEDF\uFEE5\uFE8E\uFEB3 ?'});
  expect(r.status).toBe('clarification');
  expect(r.reply).toMatch(ARABIC);
  close();
 });
 test('English question with no safe web sources gets an English clarification',async()=>{
  const scout={search:async()=>({status:'insufficient_evidence' as const,answer:'\u0645\u0627 \u0642\u062F\u0631\u062A\u0634 \u0623\u062A\u062D\u0642\u0642',sources:[]})};
  const {operator,close}=setup(false,scout);
  const r=await operator.resolve({brandId:'brand',contactId:'c',text:'What are the latest transport news today?'});
  expect(r.status).toBe('clarification');
  expect(r.reply).toMatch(/verify/i);
  expect(r.reply).not.toMatch(ARABIC);
  close();
 });
});
