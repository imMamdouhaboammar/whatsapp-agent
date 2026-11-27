import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord } from './sqlite-values';

export class AssistantSettingsStore {
  private readonly ephemeral = new Map<string, string>();

  constructor(private readonly directory: string | undefined) {}

  private path(scope: string): string {
    if (!this.directory) throw new Error('Configuration storage directory unavailable');
    return join(this.directory, 'assistant-' + createHash('sha256').update(scope).digest('hex') + '.json');
  }

  load(scope: string): unknown {
    if (!this.directory) {
      const raw = this.ephemeral.get(scope);
      return raw === undefined ? undefined : JSON.parse(raw);
    }
    try {
      return JSON.parse(readFileSync(this.path(scope),'utf8'));
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  save(scope: string, settings: unknown): void {
    const json = JSON.stringify(settings);
    if (!this.directory) {
      this.ephemeral.set(scope,json);
      return;
    }
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    const target = this.path(scope);
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary,json,{mode:0o600,flag:'wx'});
      renameSync(temporary,target);
    } finally {
      rmSync(temporary,{force:true});
    }
  }
}
