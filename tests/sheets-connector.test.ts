import {test,expect} from 'bun:test';
import {GoogleSheetsInventory} from '../src/agent/sheets-inventory';

test('Google Sheets provider reads an approved sheet live and parses quoted CSV',async()=>{
  let requested='';
  const fetcher = async (url:string) => {requested=url;return new Response('sku,stock,price,currency,name\nSKU-42,7,250,SAR,"Coat, navy"\n');};
  const provider=new GoogleSheetsInventory({sheetId:'1AbCdEf_10-zz',fetcher});
  const item=await provider.lookup('SKU-42');
  expect(requested).toContain('docs.google.com/spreadsheets/d/1AbCdEf_10-zz/export?format=csv');
  expect(item?.stock).toBe(7);
  expect(item?.price).toBe(250);
  expect(item?.name).toBe('Coat, navy');
  expect(await provider.lookup('missing')).toBeNull();
});

test('reject unsafe sheet id, bad provider numbers and overlong files',async()=>{
 expect(()=>new GoogleSheetsInventory({sheetId:'https://evil.com'})).toThrow();
 const bad=new GoogleSheetsInventory({sheetId:'approved-001',fetcher:async()=>new Response('sku,stock,price\nSKU,invalid,-3\n')});
 await expect(bad.lookup('SKU')).rejects.toThrow();
 const oversized=new GoogleSheetsInventory({sheetId:'approved-001',maxBytes:10,fetcher:async()=>new Response('sku,stock,price\nSKU,5,3')});
 await expect(oversized.lookup('SKU')).rejects.toThrow();
});
