import {Database} from 'bun:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';

export interface EvaluationRecord {
 brandId:string;
 scenarioId:string;
 intent:string;
 question:string;
 resolved:boolean;
 supported:boolean;
 missingSource?:string;
 customerPhone?:string;
}
export class QualityLoop {
 private db:Database;
 constructor({dbPath='./data/agent-quality.sqlite'}:{dbPath?:string}={}) {
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
  this.db=new Database(dbPath);
  this.db.run('PRAGMA journal_mode=WAL');
  this.db.run('CREATE TABLE IF NOT EXISTS agent_evaluations(brand_id TEXT NOT NULL,scenario_id TEXT NOT NULL,intent TEXT NOT NULL,resolved INTEGER NOT NULL,supported INTEGER NOT NULL,missing_source TEXT,question_hash TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(brand_id,scenario_id))');
  this.db.run('CREATE INDEX IF NOT EXISTS idx_evaluation_gaps ON agent_evaluations(brand_id,intent,missing_source)');
 }
 record(event:EvaluationRecord) {
  if(!event.brandId?.trim()||!event.scenarioId?.trim()||!event.intent?.trim())throw new Error('Missing evaluation identity');
  const questionHash=createHash('sha256').update(event.question).digest('hex');
  this.db.query('INSERT OR REPLACE INTO agent_evaluations(brand_id,scenario_id,intent,resolved,supported,missing_source,question_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(event.brandId,event.scenarioId,event.intent,event.resolved?1:0,event.supported?1:0,event.missingSource??null,questionHash,Date.now());
 }
 gaps(brandId:string):Array<{intent:string;missingSource:string;count:number}> {
  const rows=this.db.query('SELECT intent,missing_source,COUNT(*) AS count FROM agent_evaluations WHERE brand_id=? AND resolved=0 AND missing_source IS NOT NULL GROUP BY intent,missing_source ORDER BY count DESC').all(brandId) as any[];
  return rows.map(r=>({intent:r.intent,missingSource:r.missing_source,count:r.count}));
 }
 scorecard(brandId:string):{attempts:number;resolved:number;supported:number;autonomousResolutionRate:number|null;evidenceSupportedRate:number|null} {
  const row=this.db.query('SELECT COUNT(*) AS attempts,COALESCE(SUM(resolved),0) AS resolved,COALESCE(SUM(supported),0) AS supported FROM agent_evaluations WHERE brand_id=?').get(brandId) as {attempts:number;resolved:number;supported:number};
  return {...row,autonomousResolutionRate:row.attempts?row.resolved/row.attempts:null,evidenceSupportedRate:row.attempts?row.supported/row.attempts:null};
 }
 shouldPromote(results:Array<{scenarioId:string;before:boolean;after:boolean;required:boolean}>):boolean {
  return results.every(r=>!r.required || (r.after && (!r.before || r.after)));
 }
 close(){this.db.close();}
}
