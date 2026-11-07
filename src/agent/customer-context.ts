import {Database} from 'bun:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export interface CustomerFact {
 key:string;value:string;sourceMessageId:string;confidence:number;verifiedAt:number;expiresAt?:number;
}
export interface CustomerCase {
 caseId:string;intent:string;sourceMessageId:string;status:'open'|'closed';providerReceiptId?:string;
}
export class CustomerContextStore {
 private db:Database;
 constructor({dbPath='./data/agent-customer-context.sqlite'}:{dbPath?:string}={}) {
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
  this.db=new Database(dbPath);
  this.db.run('PRAGMA journal_mode = WAL');
  this.db.run('CREATE TABLE IF NOT EXISTS customer_facts(brand_id TEXT NOT NULL,contact_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,source_message_id TEXT NOT NULL,confidence REAL NOT NULL,verified_at INTEGER NOT NULL,expires_at INTEGER,PRIMARY KEY(brand_id,contact_id,key))');
  this.db.run('CREATE TABLE IF NOT EXISTS customer_cases(case_id TEXT PRIMARY KEY,brand_id TEXT NOT NULL,contact_id TEXT NOT NULL,intent TEXT NOT NULL,source_message_id TEXT NOT NULL,status TEXT NOT NULL,provider_receipt_id TEXT,updated_at INTEGER NOT NULL)');
  this.db.run('CREATE INDEX IF NOT EXISTS idx_cases_customer ON customer_cases(brand_id,contact_id)');
 }
 recordFact(input:{brandId:string;contactId:string;key:string;value:string;sourceMessageId:string;confidence?:number;verifiedAt?:number;expiresAt?:number}) {
  if(!input.brandId||!input.contactId||!input.key||!input.value||!input.sourceMessageId)throw new Error('Incomplete fact provenance');
  const confidence=input.confidence??1;
  if(confidence<0||confidence>1||!Number.isFinite(confidence))throw new Error('Invalid confidence');
  this.db.query('INSERT INTO customer_facts(brand_id,contact_id,key,value,source_message_id,confidence,verified_at,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(brand_id,contact_id,key) DO UPDATE SET value=excluded.value,source_message_id=excluded.source_message_id,confidence=excluded.confidence,verified_at=excluded.verified_at,expires_at=excluded.expires_at').run(input.brandId,input.contactId,input.key,input.value,input.sourceMessageId,confidence,input.verifiedAt??Date.now(),input.expiresAt??null);
 }
 openCase({brandId,contactId,intent,sourceMessageId}:{brandId:string;contactId:string;intent:string;sourceMessageId:string}) {
  if(!brandId||!contactId||!intent||!sourceMessageId)throw new Error('Incomplete case provenance');
  const caseId=randomUUID();
  this.db.query('INSERT INTO customer_cases(case_id,brand_id,contact_id,intent,source_message_id,status,updated_at) VALUES(?,?,?,?,?,?,?)').run(caseId,brandId,contactId,intent,sourceMessageId,'open',Date.now());
  return caseId;
 }
 closeCase({brandId,contactId,caseId,providerReceiptId}:{brandId:string;contactId:string;caseId:string;providerReceiptId?:string}) {
  if(!providerReceiptId?.trim())throw new Error('Verified provider receipt required to close case');
  const result=this.db.query("UPDATE customer_cases SET status='closed',provider_receipt_id=?,updated_at=? WHERE brand_id=? AND contact_id=? AND case_id=? AND status='open'").run(providerReceiptId,Date.now(),brandId,contactId,caseId);
  if(result.changes!==1)throw new Error('Open case not found');
 }
 getContext({brandId,contactId,now=Date.now()}:{brandId:string;contactId:string;now?:number}):{facts:CustomerFact[];cases:CustomerCase[]} {
  const rows=this.db.query('SELECT key,value,source_message_id,confidence,verified_at,expires_at FROM customer_facts WHERE brand_id=? AND contact_id=? AND (expires_at IS NULL OR expires_at > ?) ORDER BY verified_at DESC LIMIT 500').all(brandId,contactId,now) as any[];
  const cases=this.db.query('SELECT case_id,intent,source_message_id,status,provider_receipt_id FROM customer_cases WHERE brand_id=? AND contact_id=? ORDER BY updated_at DESC LIMIT 500').all(brandId,contactId) as any[];
  return {
   facts:rows.map(row=>({key:row.key,value:row.value,sourceMessageId:row.source_message_id,confidence:row.confidence,verifiedAt:row.verified_at,expiresAt:row.expires_at??undefined})),
   cases:cases.map(row=>({caseId:row.case_id,intent:row.intent,sourceMessageId:row.source_message_id,status:row.status,providerReceiptId:row.provider_receipt_id??undefined}))
  };
 }
 deleteCustomer(brandId:string,contactId:string) {
  const remove=this.db.transaction(()=>{
   this.db.query('DELETE FROM customer_facts WHERE brand_id=? AND contact_id=?').run(brandId,contactId);
   this.db.query('DELETE FROM customer_cases WHERE brand_id=? AND contact_id=?').run(brandId,contactId);
  });
  remove();
 }
 close(){this.db.close();}
}
