import { SQL } from 'bun';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LearningPersistenceStore } from '../../domain/learning-memory';
import type { ModerationFeedbackEvent } from '../../ai/reflection-engine';

export interface PostgresReflectionRunRecord {
  id?: string;
  brandId?: string;
  chatId: string;
  triggerReason: string;
  inputMessageCount: number;
  selfCorrectionsCount?: number;
  rulesAdded?: number;
  factsAdded?: number;
  summary?: string;
  rawEvaluationJson?: Record<string, unknown>;
  createdAt?: number;
}

export class PostgresLearningStore implements LearningPersistenceStore {
  private sql?: SQL;
  private supabase?: SupabaseClient;

  constructor(options: { sql?: SQL; supabase?: SupabaseClient; databaseUrl?: string }) {
    if (options.sql) {
      this.sql = options.sql;
    } else if (options.databaseUrl) {
      this.sql = new SQL(options.databaseUrl);
    }
    this.supabase = options.supabase;
  }

  private getSql(): SQL {
    if (this.sql) return this.sql;
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      this.sql = new SQL(dbUrl);
      return this.sql;
    }
    throw new Error('PostgresLearningStore requires DATABASE_URL or an active SQL client');
  }

  /**
   * Upserts the active markdown state (workbook or notebook) into Supabase PostgreSQL
   */
  async saveLearningState(brandId: string, stateType: 'workbook' | 'notebook', content: string): Promise<void> {
    const id = `${brandId}:${stateType}`;
    const now = Date.now();
    const sql = this.getSql();

    await sql`
      INSERT INTO wa_agent.learning_states (id, brand_id, state_type, content, version, updated_at)
      VALUES (${id}, ${brandId}, ${stateType}, ${content}, 1, ${now})
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        version = wa_agent.learning_states.version + 1,
        updated_at = EXCLUDED.updated_at;
    `;
  }

  /**
   * Retrieves the current state for a given brand and type from Supabase PostgreSQL
   */
  async getLearningState(brandId: string, stateType: 'workbook' | 'notebook'): Promise<{ content: string; version: number; updatedAt: number } | undefined> {
    const id = `${brandId}:${stateType}`;
    const sql = this.getSql();

    const rows = await sql`
      SELECT content, version, updated_at 
      FROM wa_agent.learning_states 
      WHERE id = ${id} 
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) return undefined;
    const row = rows[0] as { content: string; version: number; updated_at: number };
    return {
      content: String(row.content),
      version: Number(row.version),
      updatedAt: Number(row.updated_at)
    };
  }

  /**
   * Persists an autonomous reflection run to Supabase PostgreSQL
   */
  async saveReflectionRun(record: PostgresReflectionRunRecord): Promise<void> {
    const id = record.id || `refl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const brandId = record.brandId || 'default';
    const now = record.createdAt || Date.now();
    const sql = this.getSql();

    await sql`
      INSERT INTO wa_agent.learning_reflections (
        id, brand_id, chat_id, trigger_reason, input_message_count,
        self_corrections_count, rules_added, facts_added, summary,
        raw_evaluation_json, created_at
      ) VALUES (
        ${id}, ${brandId}, ${record.chatId}, ${record.triggerReason}, ${record.inputMessageCount},
        ${record.selfCorrectionsCount ?? 0}, ${record.rulesAdded ?? 0}, ${record.factsAdded ?? 0},
        ${record.summary ?? null}, ${record.rawEvaluationJson ? JSON.stringify(record.rawEvaluationJson) : null}, ${now}
      );
    `;
  }

  /**
   * Lists past reflection runs for auditing and inspection
   */
  async getReflectionRuns(chatId?: string, limit = 20): Promise<PostgresReflectionRunRecord[]> {
    const sql = this.getSql();
    let rows: any[];

    if (chatId) {
      rows = await sql`
        SELECT id, brand_id, chat_id, trigger_reason, input_message_count,
               self_corrections_count, rules_added, facts_added, summary, created_at
        FROM wa_agent.learning_reflections
        WHERE chat_id = ${chatId}
        ORDER BY created_at DESC
        LIMIT ${limit};
      `;
    } else {
      rows = await sql`
        SELECT id, brand_id, chat_id, trigger_reason, input_message_count,
               self_corrections_count, rules_added, facts_added, summary, created_at
        FROM wa_agent.learning_reflections
        ORDER BY created_at DESC
        LIMIT ${limit};
      `;
    }

    return rows.map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      chatId: r.chat_id,
      triggerReason: r.trigger_reason,
      inputMessageCount: Number(r.input_message_count),
      selfCorrectionsCount: Number(r.self_corrections_count),
      rulesAdded: Number(r.rules_added),
      factsAdded: Number(r.facts_added),
      summary: r.summary,
      createdAt: Number(r.created_at)
    }));
  }

  /**
   * Records human moderation feedback (e.g. draft rejected or edited) in Supabase PostgreSQL
   */
  async recordModerationFeedback(feedback: ModerationFeedbackEvent & { brandId?: string }): Promise<void> {
    const id = `fb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const brandId = feedback.brandId || 'default';
    const sql = this.getSql();

    await sql`
      INSERT INTO wa_agent.learning_feedback_events (
        id, brand_id, chat_id, draft_id, feedback_type,
        original_reply, revised_reply, human_note, reflected, created_at
      ) VALUES (
        ${id}, ${brandId}, ${feedback.chatId}, ${feedback.draftId ?? null}, ${feedback.feedbackType},
        ${feedback.originalReply ?? null}, ${feedback.revisedReply ?? null}, ${feedback.humanNote ?? null},
        0, ${Date.now()}
      );
    `;
  }

  /**
   * Retrieves unreflected moderation feedback events
   */
  async getUnreflectedFeedback(chatId?: string): Promise<ModerationFeedbackEvent[]> {
    const sql = this.getSql();
    let rows: any[];

    if (chatId) {
      rows = await sql`
        SELECT id, chat_id, draft_id, feedback_type, original_reply, revised_reply, human_note
        FROM wa_agent.learning_feedback_events
        WHERE chat_id = ${chatId} AND reflected = 0
        ORDER BY created_at ASC;
      `;
    } else {
      rows = await sql`
        SELECT id, chat_id, draft_id, feedback_type, original_reply, revised_reply, human_note
        FROM wa_agent.learning_feedback_events
        WHERE reflected = 0
        ORDER BY created_at ASC;
      `;
    }

    return rows.map((r) => ({
      chatId: r.chat_id,
      draftId: r.draft_id ?? undefined,
      feedbackType: r.feedback_type as ModerationFeedbackEvent['feedbackType'],
      originalReply: r.original_reply ?? undefined,
      revisedReply: r.revised_reply ?? undefined,
      humanNote: r.human_note ?? undefined
    }));
  }

  /**
   * Marks moderation feedback events as reflected
   */
  async markFeedbackReflected(chatId: string): Promise<void> {
    const sql = this.getSql();
    await sql`
      UPDATE wa_agent.learning_feedback_events
      SET reflected = 1
      WHERE chat_id = ${chatId} AND reflected = 0;
    `;
  }

  /**
   * Records conversation activity in Supabase PostgreSQL
   */
  async updateThreadActivity(brandId: string, chatId: string, timestamp = Date.now()): Promise<void> {
    const sql = this.getSql();
    await sql`
      INSERT INTO wa_agent.thread_learning_status (brand_id, chat_id, last_activity_at, last_reflected_at, is_cold, updated_at)
      VALUES (${brandId}, ${chatId}, ${timestamp}, 0, 0, ${Date.now()})
      ON CONFLICT (brand_id, chat_id) DO UPDATE SET
        last_activity_at = GREATEST(wa_agent.thread_learning_status.last_activity_at, EXCLUDED.last_activity_at),
        updated_at = EXCLUDED.updated_at;
    `;
  }

  /**
   * Finds threads that have gone cold (idle >= threshold) or have unreflected feedback
   */
  async getColdThreads(brandId: string, idleThresholdMs: number, limit = 5): Promise<string[]> {
    const sql = this.getSql();
    const cutoff = Date.now() - idleThresholdMs;

    const rows = await sql`
      SELECT chat_id
      FROM wa_agent.thread_learning_status
      WHERE brand_id = ${brandId}
        AND last_activity_at <= ${cutoff}
        AND (last_activity_at > last_reflected_at OR EXISTS (
          SELECT 1 FROM wa_agent.learning_feedback_events fb
          WHERE fb.chat_id = wa_agent.thread_learning_status.chat_id AND fb.reflected = 0
        ))
      ORDER BY last_activity_at ASC
      LIMIT ${limit};
    `;

    return rows.map((r: any) => String(r.chat_id));
  }

  /**
   * Marks thread reflection completed in Supabase PostgreSQL
   */
  async markThreadReflected(brandId: string, chatId: string, timestamp = Date.now()): Promise<void> {
    const sql = this.getSql();
    await sql`
      UPDATE wa_agent.thread_learning_status
      SET last_reflected_at = ${timestamp}, updated_at = ${Date.now()}
      WHERE brand_id = ${brandId} AND chat_id = ${chatId};
    `;
  }
}
