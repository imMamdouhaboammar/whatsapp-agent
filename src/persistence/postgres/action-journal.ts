import { createHash, randomUUID } from 'node:crypto';
import type { ToolInvocation } from '../../agent/tools';
import { scrubCredentials } from '../../domain/learning-memory';
import type { PgClient, PgTransaction } from './migrate';

/** First async PostgreSQL S3 slice. No active runtime cutover is implied. */
export interface PostgresActionRun {
  brand_id: string;
  key: string;
  workflow_id: string;
  tool_name: string;
  input_hash: string;
  status: 'attempting' | 'confirmed' | 'uncertain';
  output_json: string | null;
  created_at: number;
}

export interface AsyncActionJournal {
  createWorkflow(input: {
    brandId: string; contactId: string; goal: string; workflowId?: string;
  }): Promise<string>;
  updateWorkflow(brandId: string, workflowId: string, state: string): Promise<void>;
  getRun(brandId: string, key: string): Promise<PostgresActionRun | null>;
  begin(input: ToolInvocation): Promise<{ isNew: boolean; row: PostgresActionRun }>;
  finish(brandId: string, key: string, status: 'confirmed' | 'uncertain', output?: unknown): Promise<void>;
}

function requireIdentity(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new Error(`Invalid ${label}`);
  }
}

function inputHash(input: ToolInvocation): string {
  return createHash('sha256')
    .update(JSON.stringify({ toolName: input.toolName, input: input.input }))
    .digest('hex');
}

function normalizeRun(row: Record<string, unknown>): PostgresActionRun {
  const status = String(row.status);
  if (!['attempting', 'confirmed', 'uncertain'].includes(status)) {
    throw new Error('Unsupported stored tool run status');
  }
  return {
    brand_id: String(row.brand_id),
    key: String(row.key),
    workflow_id: String(row.workflow_id),
    tool_name: String(row.tool_name),
    input_hash: String(row.input_hash),
    status: status as PostgresActionRun['status'],
    output_json: row.output_json === null || row.output_json === undefined
      ? null : String(row.output_json),
    created_at: Number(row.created_at)
  };
}

/**
 * Transactional async action journal backed by the private wa_agent schema.
 * Every lookup/update is tenant-qualified. Write claims never replay provider actions.
 */
export class PostgresActionJournal implements AsyncActionJournal {
  private readonly now: () => number;

  constructor(private readonly client: PgClient, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  private timestamp(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid journal timestamp');
    return now;
  }

  async createWorkflow(input: {
    brandId: string; contactId: string; goal: string; workflowId?: string;
  }): Promise<string> {
    requireIdentity(input.brandId, 'brand');
    requireIdentity(input.contactId, 'contact');
    requireIdentity(input.goal, 'workflow goal');
    const workflowId = input.workflowId ?? randomUUID();
    requireIdentity(workflowId, 'workflow ID');
    const goal = scrubCredentials(input.goal);
    const now = this.timestamp();

    return this.client.begin(async tx => {
      await tx.unsafe(`
        INSERT INTO wa_agent.agent_workflows
          (workflow_id, brand_id, contact_id, goal, state, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (workflow_id) DO NOTHING RETURNING workflow_id
      `, [workflowId, input.brandId, input.contactId, goal, 'received', now, now]);
      const rows = await tx.unsafe(
        'SELECT brand_id FROM wa_agent.agent_workflows WHERE workflow_id=$1',
        [workflowId]
      );
      if (rows.length !== 1 || rows[0]?.brand_id !== input.brandId) {
        throw new Error('Workflow owner brand conflict');
      }
      return workflowId;
    });
  }

  async updateWorkflow(brandId: string, workflowId: string, state: string): Promise<void> {
    requireIdentity(brandId, 'brand');
    requireIdentity(workflowId, 'workflow ID');
    requireIdentity(state, 'workflow state');
    const rows = await this.client.begin(tx => tx.unsafe(`
      UPDATE wa_agent.agent_workflows SET state=$1, updated_at=$2
      WHERE brand_id=$3 AND workflow_id=$4 RETURNING workflow_id
    `, [state, this.timestamp(), brandId, workflowId]));
    if (rows.length !== 1) throw new Error('Workflow not found for brand');
  }

  private async getRunTx(tx: PgTransaction, brandId: string, key: string): Promise<PostgresActionRun | null> {
    const rows = await tx.unsafe(`
      SELECT brand_id, "key", workflow_id, tool_name, input_hash, status, output_json, created_at
      FROM wa_agent.agent_tool_runs WHERE brand_id=$1 AND "key"=$2 LIMIT 1
    `, [brandId, key]);
    return rows[0] ? normalizeRun(rows[0]) : null;
  }

  async getRun(brandId: string, key: string): Promise<PostgresActionRun | null> {
    requireIdentity(brandId, 'brand');
    requireIdentity(key, 'idempotency key');
    return this.client.begin(tx => this.getRunTx(tx, brandId, key));
  }

  async begin(input: ToolInvocation): Promise<{ isNew: boolean; row: PostgresActionRun }> {
    requireIdentity(input.brandId, 'brand');
    requireIdentity(input.workflowId, 'workflow ID');
    requireIdentity(input.toolName, 'tool name');
    requireIdentity(input.idempotencyKey, 'idempotency key');
    const hash = inputHash(input);
    const now = this.timestamp();
    return this.client.begin(async tx => {
      const workflow = await tx.unsafe(`
        SELECT workflow_id FROM wa_agent.agent_workflows
        WHERE brand_id=$1 AND workflow_id=$2 LIMIT 1
      `, [input.brandId, input.workflowId]);
      if (workflow.length !== 1) throw new Error('Workflow not found for brand');
      const inserted = await tx.unsafe(`
        INSERT INTO wa_agent.agent_tool_runs
          (brand_id, "key", workflow_id, tool_name, input_hash, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (brand_id, "key") DO NOTHING RETURNING brand_id
      `, [
        input.brandId, input.idempotencyKey, input.workflowId, input.toolName,
        hash, 'attempting', now, now
      ]);
      const row = await this.getRunTx(tx, input.brandId, input.idempotencyKey);
      if (!row) throw new Error('PostgreSQL tool claim not persisted');
      if (row.workflow_id !== input.workflowId || row.tool_name !== input.toolName || row.input_hash !== hash) {
        throw new Error('Idempotency key conflict');
      }
      return { isNew: inserted.length === 1, row };
    });
  }

  async finish(
    brandId: string, key: string, status: 'confirmed' | 'uncertain', output?: unknown
  ): Promise<void> {
    requireIdentity(brandId, 'brand');
    requireIdentity(key, 'idempotency key');
    if (status !== 'confirmed' && status !== 'uncertain') throw new Error('Invalid tool completion state');
    const serialized = output === undefined ? null : scrubCredentials(JSON.stringify(output));
    await this.client.begin(async tx => {
      // Confirmed receipts are immutable. Reconciliation may advance uncertain to confirmed.
      // The predicate is evaluated by PostgreSQL after any competing row lock is released.
      const rows = await tx.unsafe(`
        UPDATE wa_agent.agent_tool_runs
        SET status=$1, output_json=$2, updated_at=$3
        WHERE brand_id=$4 AND "key"=$5
          AND (status='attempting' OR (status='uncertain' AND $1='confirmed'))
        RETURNING "key"
      `, [status, serialized, this.timestamp(), brandId, key]);
      if (rows.length === 1) return;
      const existing = await this.getRunTx(tx, brandId, key);
      if (!existing) throw new Error('Tool run not found for brand');
      if (existing.status !== status || existing.output_json !== serialized) {
        throw new Error('Tool completion conflict');
      }
    });
  }

  async close(): Promise<void> {
    await this.client.close?.();
  }
}
