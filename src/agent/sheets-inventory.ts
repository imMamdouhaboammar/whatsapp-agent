export interface InventoryItem {
  sku: string;
  stock: number;
  price: number;
  currency: string;
  name: string;
  observedAt: number;
  sourceUrl: string;
}
type Fetcher = (url:string,init?:RequestInit)=>Promise<Response>;

function parseCsv(value:string):string[][] {
  const rows:string[][]=[]; let row:string[]=[]; let field='';let inQuotes=false;
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(c==='"'){
      if(inQuotes && value[i+1]==='"'){field+='"';i++;}
      else inQuotes=!inQuotes;
    } else if(c===',' && !inQuotes){row.push(field);field='';}
    else if((c==='\n' || c==='\r') && !inQuotes){
      if(c==='\r' && value[i+1]==='\n')i++;
      row.push(field);if(row.some(v=>v.trim()))rows.push(row);
      row=[];field='';
    } else field+=c;
  }
  if(inQuotes)throw new Error('Invalid quoted CSV');
  row.push(field);if(row.some(v=>v.trim()))rows.push(row);
  return rows;
}

export class GoogleSheetsInventory {
  readonly sourceUrl:string;
  private fetcher:Fetcher;
  private maxBytes:number;
  constructor(options:{sheetId:string;gid?:string;fetcher?:Fetcher;maxBytes?:number}) {
    if(!/^[A-Za-z0-9_-]{8,160}$/.test(options.sheetId))throw new Error('Invalid sheet ID');
    if(options.gid && !/^\d{1,15}$/.test(options.gid))throw new Error('Invalid worksheet gid');
    this.sourceUrl='https://docs.google.com/spreadsheets/d/'+options.sheetId+'/export?format=csv'+(options.gid?'&gid='+options.gid:'');
    this.fetcher=options.fetcher ?? fetch;
    this.maxBytes=options.maxBytes ?? 1024*1024;
  }

  async lookup(sku:string):Promise<InventoryItem|null> {
    if(!sku || sku.length>128)throw new Error('Invalid SKU');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    try {
      const response=await this.fetcher(this.sourceUrl,{signal:controller.signal,redirect:'error'});
      if(!response.ok)throw new Error('Inventory provider unavailable');
      if(Number(response.headers.get('content-length')??0)>this.maxBytes)throw new Error('Sheet too large');
      const reader=response.body?.getReader();
      if(!reader)throw new Error('Provider did not return content');
      const decoder=new TextDecoder();
      let text='';let size=0;
      for(;;) {
        const {done,value}=await reader.read();
        if(done)break;
        size+=value.byteLength;
        if(size>this.maxBytes){await reader.cancel();throw new Error('Sheet too large');}
        text+=decoder.decode(value,{stream:true});
      }
      text+=decoder.decode();
      const rows=parseCsv(text.replace(/^\uFEFF/,''));
      if(!rows.length)throw new Error('Empty sheet');
      const headers=rows[0].map(c=>c.trim().toLowerCase());
      for(const required of ['sku','stock','price'])if(!headers.includes(required))throw new Error('Missing inventory column: '+required);
      const read=(row:string[],col:string)=>row[headers.indexOf(col)]?.trim()??'';
      for(const row of rows.slice(1)) {
        if(read(row,'sku').toLowerCase()!==sku.trim().toLowerCase())continue;
        const stock=Number(read(row,'stock'));const price=Number(read(row,'price'));
        if(!Number.isSafeInteger(stock)||stock<0||!Number.isFinite(price)||price<0||!read(row,'stock')||!read(row,'price'))throw new Error('Invalid stock or price');
        return {sku:read(row,'sku'),stock,price,currency:read(row,'currency')||'SAR',name:read(row,'name'),observedAt:Date.now(),sourceUrl:this.sourceUrl};
      }
      return null;
    } finally {clearTimeout(timeout);}
  }
}
