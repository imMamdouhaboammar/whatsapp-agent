import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import type {SourceType} from './brand-knowledge';

export interface ExtractedSection {location:string;text:string;}
export interface ExtractionRequest {
  brandId:string;messageId:string;mimeType:string;data:Uint8Array;maxBytes?:number;
}
export interface ExtractionResult {
  brandId:string;messageId:string;mimeType:string;sections:ExtractedSection[];truncated:boolean;
}
const DEFAULT_WORKER=fileURLToPath(new URL('../../workers/media-python/document_worker.py',import.meta.url));
const VENV_PYTHON=fileURLToPath(new URL('../../workers/media-python/.venv/bin/python',import.meta.url));
export class DocumentExtractionService {
  constructor(private readonly opts:{pythonBin?:string;workerPath?:string;timeoutMs?:number}={}){}
  async extract(input:ExtractionRequest):Promise<ExtractionResult>{
    const sizeLimit=Math.min(input.maxBytes??15*1024*1024,15*1024*1024);
    if(!input.brandId || !input.messageId || !input.mimeType)throw new Error('Missing document lineage');
    if(!(input.data instanceof Uint8Array) || !input.data.byteLength || input.data.byteLength>sizeLimit)throw new Error('Document size exceeds limit or is empty');
    const body=JSON.stringify({mimeType:input.mimeType,base64:Buffer.from(input.data).toString('base64')});
    return await new Promise<ExtractionResult>((resolve,reject)=>{
      const subprocess=spawn(this.opts.pythonBin??process.env.AGENT_MEDIA_PYTHON??(existsSync(VENV_PYTHON)?VENV_PYTHON:'python3'),[this.opts.workerPath??DEFAULT_WORKER],{
        stdio:['pipe','pipe','pipe'],
        env:{PATH:process.env.PATH??'/usr/bin:/bin',PYTHONNOUSERSITE:'1'}
      });
      let output='';let complete=false;
      const timeout=setTimeout(()=>subprocess.kill('SIGKILL'),this.opts.timeoutMs??15000);
      subprocess.stdout.setEncoding('utf8');
      subprocess.stdout.on('data',(chunk:string)=>{
        output+=chunk;
        if(output.length>8*1024*1024)subprocess.kill('SIGKILL');
      });
      subprocess.stderr.on('data',()=>{ /* no sensitive attachment data to logs */ });
      subprocess.on('error',(error)=>{if(!complete){complete=true;clearTimeout(timeout);reject(new Error('Document worker unavailable: '+error.message));}});
      subprocess.on('close',(_code)=>{
        clearTimeout(timeout);
        if(complete)return;
        complete=true;
        try{
          const parsed=JSON.parse(output);
          if(!parsed.ok || !Array.isArray(parsed.sections))throw new Error(parsed.error??'Document extraction failed');
          resolve({brandId:input.brandId,messageId:input.messageId,mimeType:input.mimeType,sections:parsed.sections,truncated:!!parsed.truncated});
        }catch(error){reject(new Error(error instanceof Error?error.message:'Document extraction failed'));}
      });
      subprocess.stdin.on('error',()=>{});
      subprocess.stdin.end(body);
    });
  }
  /** Owner-only ingestion; customer uploads are not promoted into Brand Brain. */
  toKnowledgeContent(result:ExtractionResult):{type:SourceType;content:string}{
    const content=result.sections.map(section=>'['+section.location+'] '+section.text).join('\n');
    if(Buffer.byteLength(content,'utf8')>1024*1024)throw new Error('Document exceeds Brand Brain ingestion cap');
    return {type:'text',content};
  }
}
