import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type ToolResult = {status:'confirmed'|'uncertain';output?:unknown;reason?:string;receiptId?:string};
export type ToolDefinition<T=any> = {
  name:string;
  kind:'read'|'write';
  scope:string;
  description?:string;
  parameters?:{type:'OBJECT';properties:Record<string,unknown>;required?:string[]};
  validate:(value:unknown)=>value is T;
  execute:(input:T,ctx:{brandId:string;workflowId:string;idempotencyKey:string})=>Promise<unknown>;
  reconcile?:(input:T,ctx:{brandId:string;workflowId:string;idempotencyKey:string})=>Promise<unknown|null>;
};
export interface ToolInvocation {
  brandId:string; toolName:string;workflowId:string;idempotencyKey:string;input:unknown;
}
type RunRecord={brand_id:string;key:string;tool_name:string;input_hash:string;status:string;output_json:string|null;created_at:number};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export class ActionJournal {
  private db:Database;
  constructor({dbPath='./data/agent-actions.sqlite'}:{dbPath?:string}={}) {
    if (dbPath!==':memory:') mkdirSync(dirname(dbPath),{recursive:true});
    this.db=new Database(dbPath);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA busy_timeout = 5000');
    this.db.run('CREATE TABLE IF NOT EXISTS agent_workflows (workflow_id TEXT PRIMARY KEY,brand_id TEXT NOT NULL,contact_id TEXT NOT NULL,goal TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)');
    this.db.run('CREATE TABLE IF NOT EXISTS agent_tool_runs (brand_id TEXT NOT NULL,key TEXT NOT NULL,workflow_id TEXT NOT NULL,tool_name TEXT NOT NULL,input_hash TEXT NOT NULL,status TEXT NOT NULL,output_json TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(brand_id,key))');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_tool_runs_workflow ON agent_tool_runs(workflow_id,brand_id)');
  }
  createWorkflow({brandId,contactId,goal,workflowId=randomUUID()}:{brandId:string;contactId:string;goal:string;workflowId?:string}) {
    this.db.query('INSERT OR IGNORE INTO agent_workflows(workflow_id,brand_id,contact_id,goal,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(workflowId,brandId,contactId,goal,'received',Date.now(),Date.now());
    return workflowId;
  }
  updateWorkflow(brandId:string,workflowId:string,state:string) {
    this.db.query('UPDATE agent_workflows SET state=?,updated_at=? WHERE brand_id=? AND workflow_id=?').run(state,Date.now(),brandId,workflowId);
  }
  getRun(brandId:string,key:string):RunRecord|null {
    return (this.db.query('SELECT brand_id,key,tool_name,input_hash,status,output_json,created_at FROM agent_tool_runs WHERE brand_id=? AND key=? LIMIT 1').get(brandId,key) as RunRecord|null);
  }
  begin(input:ToolInvocation):{isNew:boolean;row:RunRecord} {
    const inputHash=hash(JSON.stringify({toolName:input.toolName,input:input.input}));
    const transaction=this.db.transaction(()=>{
      const result=this.db.query('INSERT OR IGNORE INTO agent_tool_runs(brand_id,key,workflow_id,tool_name,input_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(input.brandId,input.idempotencyKey,input.workflowId,input.toolName,inputHash,'attempting',Date.now(),Date.now());
      const row=this.getRun(input.brandId,input.idempotencyKey)!;
      if(row.tool_name!==input.toolName || row.input_hash!==inputHash) throw new Error('Idempotency key conflict');
      return {isNew:result.changes===1,row};
    });
    // Atomic across competing processes sharing the SQLite database.
    return transaction();
  }
  finish(brandId:string,key:string,status:'confirmed'|'uncertain',output?:unknown) {
    this.db.query('UPDATE agent_tool_runs SET status=?,output_json=?,updated_at=? WHERE brand_id=? AND key=?').run(status,output===undefined?null:JSON.stringify(output),Date.now(),brandId,key);
  }
  close(){this.db.close();}
}
export class ToolRegistry {
  private tools=new Map<string,Map<string,ToolDefinition>>();
  constructor(private readonly journal:ActionJournal){}
  register<T>(brandId:string,tool:ToolDefinition<T>) {
    if(!brandId || !tool.name || !tool.scope || !['read','write'].includes(tool.kind)) throw new Error('Invalid tool declaration');
    let tools=this.tools.get(brandId);
    if(!tools){tools=new Map();this.tools.set(brandId,tools);}
    tools.set(tool.name,tool as ToolDefinition);
  }
  list(brandId:string):Array<{name:string;kind:'read'|'write';scope:string}> {
    return [...(this.tools.get(brandId)?.values() ?? [])].map(({name,kind,scope})=>({name,kind,scope}));
  }
  listManifests(brandId:string):Array<{name:string;kind:'read'|'write';scope:string;description:string;parameters?:ToolDefinition['parameters']}> {
    return [...(this.tools.get(brandId)?.values() ?? [])].map(({name,kind,scope,description,parameters})=>({name,kind,scope,description:description??name,parameters}));
  }
  async run(invocation:ToolInvocation):Promise<ToolResult> {
    const tool=this.tools.get(invocation.brandId)?.get(invocation.toolName);
    if(!tool) throw new Error('Tool not authorized for brand');
    if(!tool.validate(invocation.input)) throw new Error('Invalid tool arguments');
    if(tool.kind==='read') {
      const output=await tool.execute(invocation.input,{brandId:invocation.brandId,workflowId:invocation.workflowId,idempotencyKey:invocation.idempotencyKey});
      return {status:'confirmed',output};
    }
    if(!invocation.idempotencyKey?.trim()) throw new Error('Write requires idempotency key');
    const context={brandId:invocation.brandId,workflowId:invocation.workflowId,idempotencyKey:invocation.idempotencyKey};
    const claim=this.journal.begin(invocation);
    if(!claim.isNew){
      if(claim.row.status==='confirmed') return {status:'confirmed',output:claim.row.output_json ? JSON.parse(claim.row.output_json):undefined};
      if(tool.reconcile){
        try {
          const reconciled=await tool.reconcile(invocation.input,context);
          if(reconciled!==null && reconciled!==undefined) {
            this.journal.finish(invocation.brandId,invocation.idempotencyKey,'confirmed',reconciled);
            return {status:'confirmed',output:reconciled};
          }
        } catch { /* a failed reconciliation is never a reason to repeat a write */ }
      }
      this.journal.finish(invocation.brandId,invocation.idempotencyKey,'uncertain');
      return {status:'uncertain',reason:'Await provider reconciliation; write was not retried'};
    }
    try{
      const output=await tool.execute(invocation.input,context);
      this.journal.finish(invocation.brandId,invocation.idempotencyKey,'confirmed',output);
      return {status:'confirmed',output};
    } catch {
      this.journal.finish(invocation.brandId,invocation.idempotencyKey,'uncertain');
      return {status:'uncertain',reason:'Provider outcome unknown; do not retry automatically'};
    }
  }
}
