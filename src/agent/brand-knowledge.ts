import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SourceAuthority = 'official' | 'working' | 'external';
export type SourceType = 'text' | 'faq' | 'csv';
export interface KnowledgeInput {
  brandId: string;
  type: SourceType;
  locator: string;
  content: string;
  authority: SourceAuthority;
  locale?: string;
}
export interface SourceConflict {
  field:'returns_days';
  values:number[];
  sourceIds:string[];
  versionIds:string[];
}
export interface Evidence {
  sourceId: string;
  versionId: string;
  text: string;
  location: string;
  authority: SourceAuthority;
  lastChecked: number;
  score: number;
}
export type EmbeddingProvider = (text: string) => Promise<number[]>;

function sha(text: string) {
  return createHash('sha256').update(text).digest('hex');
}
function normalized(text: string, maxDepth = 1): string {
  if (maxDepth < 1) return text;
  return text.toLowerCase().normalize('NFKC').replace(/[\u064b-\u065f\u0670]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي');
}
function terms(text: string) {
  return [...new Set(normalized(text).match(/[\p{L}\p{N}]+/gu) ?? [])];
}
function cosine(a: number[] | undefined, b: number[] | undefined) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  const dot = a.reduce((v,x,i)=>v+x*b[i],0);
  const lenA = Math.sqrt(a.reduce((v,x)=>v+x*x,0));
  const lenB = Math.sqrt(b.reduce((v,x)=>v+x*x,0));
  return lenA && lenB ? dot/(lenA*lenB) : 0;
}

export class BrandKnowledgeStore {
  private db: Database;
  private embed?: EmbeddingProvider;
  constructor(options: {dbPath?: string; embed?: EmbeddingProvider} = {}) {
    const path = options.dbPath ?? './data/brand-knowledge.sqlite';
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
    this.db = new Database(path);
    this.embed = options.embed;
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA busy_timeout = 5000');
    this.db.run('CREATE TABLE IF NOT EXISTS brand_sources (source_id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, type TEXT NOT NULL, locator TEXT NOT NULL, authority TEXT NOT NULL, locale TEXT, retired INTEGER NOT NULL DEFAULT 0, UNIQUE(brand_id,type,locator))');
    this.db.run('CREATE TABLE IF NOT EXISTS brand_source_versions (version_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, hash TEXT NOT NULL, current INTEGER NOT NULL, last_checked INTEGER NOT NULL, FOREIGN KEY(source_id) REFERENCES brand_sources(source_id))');
    this.db.run('CREATE TABLE IF NOT EXISTS knowledge_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, version_id TEXT NOT NULL, content TEXT NOT NULL, location TEXT NOT NULL, embedding_json TEXT)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge_chunks(source_id,version_id)');
    this.db.run("CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(normalized_content, tokenize='unicode61')");
    // Legacy chunks are indexed without touching their version/retirement history.
    this.db.run('INSERT INTO knowledge_fts(rowid,normalized_content) SELECT c.id,lower(c.content) FROM knowledge_chunks c WHERE NOT EXISTS (SELECT 1 FROM knowledge_fts f WHERE f.rowid=c.id)');
  }

  async ingest(input: KnowledgeInput): Promise<{sourceId:string; versionId:string; changed:boolean}> {
    if (!input.brandId?.trim() || !input.locator?.trim() || !['faq','csv','text'].includes(input.type)) throw new Error('Invalid brand/source');
    const bytes = Buffer.byteLength(input.content ?? '', 'utf8');
    if (!bytes || bytes > 1024*1024) throw new Error('Source size is invalid');
    const sourceId = sha(JSON.stringify([input.brandId,input.type,input.locator]));
    const hash = sha(input.content);
    const current = this.db.query('SELECT v.version_id, v.hash, s.retired FROM brand_source_versions v JOIN brand_sources s ON s.source_id=v.source_id WHERE v.source_id=? AND v.current=1').get(sourceId) as {version_id:string;hash:string;retired:number}|null;
    if (current && current.hash === hash && !current.retired) return {sourceId,versionId:current.version_id,changed:false};
    const lines = input.type==='csv' ? input.content.split(/\r?\n/).filter(Boolean).slice(0,5000) : input.content.match(/[\s\S]{1,1000}/g) ?? [];
    const chunks = await Promise.all(lines.map(async (text,i)=>({
      text, location: input.type==='csv' ? 'row:'+String(i+1) : 'section:'+String(i+1),
      embedding: this.embed ? JSON.stringify(await this.embed(text)) : null
    })));
    const versionId = randomUUID();
    const write = this.db.transaction(() => {
      this.db.query('INSERT INTO brand_sources(source_id,brand_id,type,locator,authority,locale,retired) VALUES(?,?,?,?,?,?,0) ON CONFLICT(source_id) DO UPDATE SET authority=excluded.authority,locale=excluded.locale,retired=0').run(sourceId,input.brandId,input.type,input.locator,input.authority,input.locale ?? null);
      this.db.query('UPDATE brand_source_versions SET current=0 WHERE source_id=?').run(sourceId);
      this.db.query('INSERT INTO brand_source_versions(version_id,source_id,hash,current,last_checked) VALUES(?,?,?,1,?)').run(versionId,sourceId,hash,Date.now());
      const stmt=this.db.query('INSERT INTO knowledge_chunks(source_id,version_id,content,location,embedding_json) VALUES(?,?,?,?,?)');
      const index=this.db.query('INSERT INTO knowledge_fts(rowid,normalized_content) VALUES(last_insert_rowid(),?)');
      for(const chunk of chunks) {
        stmt.run(sourceId,versionId,chunk.text,chunk.location,chunk.embedding);
        index.run(normalized(chunk.text));
      }
    });
    write();
    return {sourceId,versionId,changed:true};
  }

  async retrieve(input: {brandId:string; question:string; limit?:number}) : Promise<{evidence:Evidence[]; answerability:'supported'|'insufficient'; semanticEnabled:boolean;lexicalIndex:'fts5'}> {
    if(!input.brandId?.trim() || !input.question?.trim()) return {evidence:[],answerability:'insufficient',semanticEnabled:!!this.embed,lexicalIndex:'fts5'};
    const qterms=terms(input.question);
    const qnormalized=normalized(input.question);
    const qembedding=this.embed ? await this.embed(input.question) : undefined;
    const select='SELECT s.source_id,s.authority,v.version_id,v.last_checked,c.content,c.location,c.embedding_json FROM brand_sources s JOIN brand_source_versions v ON v.source_id=s.source_id AND v.current=1 JOIN knowledge_chunks c ON c.version_id=v.version_id';
    const lexicalQuery=qterms.map(term=>'"'+term.replaceAll('"', '""')+'"').join(' OR ');
    const rows= this.embed || !lexicalQuery
      ? this.db.query(select+' WHERE s.brand_id=? AND s.retired=0').all(input.brandId) as any[]
      : this.db.query(select+" JOIN knowledge_fts ON knowledge_fts.rowid=c.id WHERE s.brand_id=? AND s.retired=0 AND knowledge_fts.normalized_content MATCH ? ORDER BY bm25(knowledge_fts) LIMIT 500").all(input.brandId,lexicalQuery) as any[];
    const hits=rows.map(row=>{
      const text=normalized(row.content);
      const matches=qterms.filter(t=>text.includes(t)).length;
      const phrase=qnormalized.length>=3 && text.includes(qnormalized) ? 1 : 0;
      const wordScore= qterms.length ? matches/qterms.length : 0;
      const semantic=cosine(qembedding,row.embedding_json ? JSON.parse(row.embedding_json):undefined);
      const score=wordScore*0.65+Math.max(semantic,0)*0.3+phrase*0.2+(row.authority==='official'?0.05:0);
      return {sourceId:row.source_id,versionId:row.version_id,text:row.content,location:row.location,authority:row.authority,lastChecked:row.last_checked,score,matched:matches>0 || semantic>=0.65};
    }).filter(hit=>hit.matched).sort((a,b)=>b.score-a.score);
    const evidence=hits.slice(0,Math.max(1,Math.min(input.limit ?? 5,30))).map(({matched,...hit})=>hit as Evidence);
    return {evidence,answerability:evidence.length ? 'supported':'insufficient',semanticEnabled:!!this.embed,lexicalIndex:'fts5'};
  }

  /** Active-source policy conflicts, never an instruction to silently override an approved policy. */
  listConflicts(brandId:string):SourceConflict[] {
    const rows=this.db.query("SELECT s.source_id,v.version_id,c.content FROM brand_sources s JOIN brand_source_versions v ON v.source_id=s.source_id AND v.current=1 JOIN knowledge_chunks c ON c.version_id=v.version_id WHERE s.brand_id=? AND s.retired=0").all(brandId) as Array<{source_id:string;version_id:string;content:string}>;
    const policies=new Map<number,Array<{sourceId:string;versionId:string}>>();
    for(const row of rows){
      const text=normalized(row.content);
      const match=text.match(/(?:الارجاع|استرجاع|returns?|refund).{0,90}?(\d{1,3})\s*(?:ايام|يوم|days?)/iu);
      if(!match)continue;
      const days=Number(match[1]);
      if(!policies.has(days))policies.set(days,[]);
      if(!policies.get(days)!.some(x=>x.sourceId===row.source_id))policies.get(days)!.push({sourceId:row.source_id,versionId:row.version_id});
    }
    if(policies.size<2)return [];
    return [{
      field:'returns_days',
      values:[...policies.keys()].sort((a,b)=>a-b),
      sourceIds:[...new Set([...policies.values()].flat().map(x=>x.sourceId))],
      versionIds:[...new Set([...policies.values()].flat().map(x=>x.versionId))]
    }];
  }

  listSources(brandId:string): Array<{sourceId:string;type:string;locator:string;authority:SourceAuthority;versionId:string;lastChecked:number}> {
    const rows=this.db.query('SELECT s.source_id,s.type,s.locator,s.authority,v.version_id,v.last_checked FROM brand_sources s JOIN brand_source_versions v ON v.source_id=s.source_id AND v.current=1 WHERE s.brand_id=? AND s.retired=0 ORDER BY v.last_checked DESC').all(brandId) as any[];
    return rows.map(row=>({sourceId:row.source_id,type:row.type,locator:row.locator,authority:row.authority,versionId:row.version_id,lastChecked:row.last_checked}));
  }
  retireSource(brandId:string,sourceId:string) {
    this.db.query('UPDATE brand_sources SET retired=1 WHERE brand_id=? AND source_id=?').run(brandId,sourceId);
  }
  close(){this.db.close();}
}
