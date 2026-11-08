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
  if (scrubCredentials(value) !== value) {
    throw new Error(`Credential-like value rejected in ${label}`);
  }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function canonicalJson(value: unknown): string {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  const ordered = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(ordered);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0
      ).map(([key, entry]) => [key, ordered(entry)]));
    }
    return item;
  };
  return JSON.stringify(ordered(normalized));
}

function inputHashes(input: ToolInvocation): { current: string; legacy: string } {
  const payload = { toolName: input.toolName, input: input.input };
  // v2 is deterministic for JSON-equivalent object key order. Legacy hash
  // remains readable so historical SQLite action claims can be reconciled.
  return { current: 'v2:' + hash(canonicalJson(payload)), legacy: hash(JSON.stringify(payload)) };
}

const SENSITIVE_RECEIPT_KEY = /(?:pass(?:word|phrase)?|passwd|secret|token|api[_-]?key|auth(?:orization)?|otp|credential|private[_-]?key|cookie|session[_-]?key)/i;
function receiptJson(output: unknown): string {
  const serialized = JSON.stringify(output, (key, value: unknown) => {
    if (key && SENSITIVE_RECEIPT_KEY.test(key)) return '[REDACTED_CREDENTIAL]';
    if (typeof value === 'string' && scrubCredentials(value) !== value) return '[REDACTED_CREDENTIAL]';
    return value;
  });
  if (typeof serialized !== 'string') throw new Error('Tool output is not JSON-serializable');
  return serialized;
}

const TERMINAL_WORKFLOW_STATES = new Set([
  'completed', 'exceptional_escalation', 'needs_customer_detail',
  'waiting_provider', 'cancelled', 'canceled', 'failed'
]);

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
  private readonly ownsClient: boolean;

  constructor(private readonly client: PgClient, options: { now?: () => number; ownsClient?: boolean } = {}) {
    this.now = options.now ?? Date.now;
    this.ownsClient = options.ownsClient ?? false;
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
    if (typeof input.goal !== 'string' || !input.goal.trim()) {
      throw new Error('Invalid workflow goal');
    }
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
        'SELECT brand_id, contact_id, goal FROM wa_agent.agent_workflows WHERE workflow_id=$1 AND brand_id=$2',
        [workflowId, input.brandId]
      );
      if (rows.length !== 1) throw new Error('Workflow owner brand conflict');
      if (rows[0]?.contact_id !== input.contactId || rows[0]?.goal !== goal) {
        throw new Error('Workflow identity conflict');
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
    const hashes = inputHashes(input);
    const now = this.timestamp();
    return this.client.begin(async tx => {
      const workflow = await tx.unsafe(`
        SELECT workflow_id, state FROM wa_agent.agent_workflows
        WHERE brand_id=$1 AND workflow_id=$2 FOR UPDATE
      `, [input.brandId, input.workflowId]);
      if (workflow.length !== 1) throw new Error('Workflow not found for brand');
      // A terminal workflow may replay its old claim for reconciliation, but
      // cannot create another provider action. FOR UPDATE orders this check
      // against an updateWorkflow completion transaction.
      if (TERMINAL_WORKFLOW_STATES.has(String(workflow[0]?.state))) {
        const prior = await this.getRunTx(tx, input.brandId, input.idempotencyKey);
        if (!prior) throw new Error('Terminal workflow rejects new action claims');
        if (prior.workflow_id !== input.workflowId || prior.tool_name !== input.toolName ||
            (prior.input_hash !== hashes.current && prior.input_hash !== hashes.legacy)) {
          throw new Error('Idempotency key conflict');
        }
        return { isNew: false, row: prior };
      }
      const inserted = await tx.unsafe(`
        INSERT INTO wa_agent.agent_tool_runs
          (brand_id, "key", workflow_id, tool_name, input_hash, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (brand_id, "key") DO NOTHING RETURNING brand_id
      `, [
        input.brandId, input.idempotencyKey, input.workflowId, input.toolName,
        hashes.current, 'attempting', now, now
      ]);
      const row = await this.getRunTx(tx, input.brandId, input.idempotencyKey);
      if (!row) throw new Error('PostgreSQL tool claim not persisted');
      if (row.workflow_id !== input.workflowId || row.tool_name !== input.toolName ||
          (row.input_hash !== hashes.current && row.input_hash !== hashes.legacy)) {
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
    const serialized = output === undefined ? null : receiptJson(output);
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
    if (this.ownsClient) await this.client.close?.();
  }
}
