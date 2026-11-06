import {test,expect} from 'bun:test';
import {CustomerContextStore} from '../src/agent/customer-context';

test('A07 E12 remembers prior commitment with message lineage and isolates brand plus contact',()=>{
 const store=new CustomerContextStore({dbPath:':memory:'});
 const old=Date.UTC(2026,7,6);
 store.recordFact({brandId:'brand-a',contactId:'contact-1',key:'promise',value:'إرسال عرض السعر يوم الأحد',sourceMessageId:'wa-original-911',verifiedAt:old,confidence:1});
 const ctx=store.getContext({brandId:'brand-a',contactId:'contact-1',now:Date.UTC(2026,10,6)});
 expect(ctx.facts).toHaveLength(1);
 expect(ctx.facts[0]?.sourceMessageId).toBe('wa-original-911');
 expect(ctx.facts[0]?.value).toContain('الأحد');
 expect(store.getContext({brandId:'brand-b',contactId:'contact-1'}).facts).toHaveLength(0);
 expect(store.getContext({brandId:'brand-a',contactId:'contact-2'}).facts).toHaveLength(0);
 store.close();
});
test('customer corrections supersede stale facts; case may close only on verified outcome',()=>{
 const store=new CustomerContextStore({dbPath:':memory:'});
 store.recordFact({brandId:'a',contactId:'c',key:'preferred_color',value:'Blue',sourceMessageId:'wa-1',confidence:.7});
 store.recordFact({brandId:'a',contactId:'c',key:'preferred_color',value:'Green',sourceMessageId:'wa-2',confidence:1});
 const facts=store.getContext({brandId:'a',contactId:'c'}).facts;
 expect(facts).toHaveLength(1);expect(facts[0]?.value).toBe('Green');
 const id=store.openCase({brandId:'a',contactId:'c',intent:'order_delay',sourceMessageId:'wa-3'});
 expect(store.getContext({brandId:'a',contactId:'c'}).cases[0]?.status).toBe('open');
 expect(()=>store.closeCase({brandId:'a',contactId:'c',caseId:id})).toThrow();
 store.closeCase({brandId:'a',contactId:'c',caseId:id,providerReceiptId:'carrier-accept-1'});
 expect(store.getContext({brandId:'a',contactId:'c'}).cases[0]?.status).toBe('closed');
 store.close();
});
test('expired fact omitted, explicit delete purges all derived facts and cases',()=>{
 const store=new CustomerContextStore({dbPath:':memory:'});
 store.recordFact({brandId:'a',contactId:'c',key:'temporary_preference',value:'Gift wrap',sourceMessageId:'m',expiresAt:100});
 expect(store.getContext({brandId:'a',contactId:'c',now:200}).facts).toHaveLength(0);
 store.openCase({brandId:'a',contactId:'c',intent:'support',sourceMessageId:'m'});
 store.deleteCustomer('a','c');
 expect(store.getContext({brandId:'a',contactId:'c',now:0}).facts).toHaveLength(0);
 expect(store.getContext({brandId:'a',contactId:'c'}).cases).toHaveLength(0);
 store.close();
});
