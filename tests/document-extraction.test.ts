import {describe,it,expect} from 'bun:test';
import {DocumentExtractionService} from '../src/agent/media-service';

describe('A04 extraction bridge with real Python worker',()=>{
 const worker=new DocumentExtractionService();
 it('extracts CSV evidence with exact message/brand lineage and quoted rows',async()=>{
   const result=await worker.extract({brandId:'brand_a',messageId:'wa-22',mimeType:'text/csv',data:Buffer.from('SKU,Price\nSKU-42,120','utf8')});
   expect(result.brandId).toBe('brand_a');
   expect(result.messageId).toBe('wa-22');
   expect(result.sections.some(s=>s.location==='row:2' && s.text.includes('SKU-42'))).toBe(true);
 });
 it('rejects overlarge customer payloads before any extraction',async()=>{
   expect(worker.extract({brandId:'a',messageId:'wa',mimeType:'text/plain',data:Buffer.alloc(1024*1024+1),maxBytes:1024*1024})).rejects.toThrow('size');
 });
});
