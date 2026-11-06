import {Database} from 'bun:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export class ConnectorSettings {
 private db:Database;
 constructor({dbPath='./data/agent-connectors.sqlite'}:{dbPath?:string}={}) {
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
  this.db=new Database(dbPath);
  this.db.run('PRAGMA journal_mode = WAL');
  this.db.run('CREATE TABLE IF NOT EXISTS brand_sheet_connectors(brand_id TEXT PRIMARY KEY,sheet_id TEXT NOT NULL,gid TEXT,enabled INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL)');
 }
 setSheet(brandId:string,sheetId:string,gid?:string) {
  this.db.query('INSERT INTO brand_sheet_connectors(brand_id,sheet_id,gid,enabled,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(brand_id) DO UPDATE SET sheet_id=excluded.sheet_id,gid=excluded.gid,enabled=1,updated_at=excluded.updated_at').run(brandId,sheetId,gid??null,Date.now());
 }
 listSheets():Array<{brandId:string;sheetId:string;gid?:string}> {
  return (this.db.query('SELECT brand_id,sheet_id,gid FROM brand_sheet_connectors WHERE enabled=1').all() as Array<{brand_id:string;sheet_id:string;gid:string|null}>).map(s=>({brandId:s.brand_id,sheetId:s.sheet_id,gid:s.gid??undefined}));
 }
 close(){this.db.close();}
}
