import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { scrubCredentials } from './learning-memory';
import type { FactorWeightDelta, OpfDiagnostics, WorldTransitionRecord } from '../ai/jepa-world-model';

export interface RsiGenerationRecord {
  generationId: number;
  parentGenerationId: number | null;
  brandId: string;
  status: 'promoted' | 'rejected';
  mutationSummary: string;
  predictedGain: number;
  observedPassRate: number;
  baselinePassRate: number;
  predictionErrorBefore: number;
  predictionErrorAfter: number;
  opfDiagnostics?: OpfDiagnostics;
  createdAt: number;
}

/**
 * Durable SQLite ledger for RSI-Anything generations, JEPA world-model transitions,
 * and learned factor weights.
 */
export class RsiLedger {
  private db: Database;

  constructor(options: { dbPath?: string } = {}) {
    const dbPath = options.dbPath ?? './data/rsi-ledger.sqlite';
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS rsi_transitions (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        intent TEXT NOT NULL,
        action TEXT NOT NULL,
        state_before_json TEXT NOT NULL,
        predicted_state_json TEXT NOT NULL,
        observed_state_json TEXT NOT NULL,
        prediction_error REAL NOT NULL,
        surprise REAL NOT NULL,
        feedback_type TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_rsi_transitions_brand ON rsi_transitions(brand_id, created_at DESC)');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS rsi_generations (
        generation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_generation_id INTEGER,
        brand_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mutation_summary TEXT NOT NULL,
        predicted_gain REAL NOT NULL,
        observed_pass_rate REAL NOT NULL,
        baseline_pass_rate REAL NOT NULL,
        prediction_error_before REAL NOT NULL,
        prediction_error_after REAL NOT NULL,
        opf_diagnostics_json TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_rsi_generations_brand ON rsi_generations(brand_id, generation_id DESC)');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS rsi_world_weights (
        brand_id TEXT NOT NULL,
        transition_key TEXT NOT NULL,
        delta_json TEXT NOT NULL,
        override_prob REAL NOT NULL,
        sample_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (brand_id, transition_key)
      )
    `);
  }

  recordTransition(brandId: string, record: WorldTransitionRecord): void {
    this.db.query(`
      INSERT OR REPLACE INTO rsi_transitions (
        id, brand_id, chat_id, intent, action,
        state_before_json, predicted_state_json, observed_state_json,
        prediction_error, surprise, feedback_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      brandId,
      scrubCredentials(record.chatId),
      record.intent,
      record.action,
      JSON.stringify(record.stateBefore),
      JSON.stringify(record.predictedState),
      JSON.stringify(record.observedState),
      record.predictionError,
      record.surprise,
      record.feedbackType,
      record.createdAt
    );
  }

  getRecentTransitions(brandId: string, limit = 100): WorldTransitionRecord[] {
    const safeLimit = Math.max(1, Math.min(500, limit));
    const rows = this.db.query(`
      SELECT id, chat_id, intent, action, state_before_json, predicted_state_json,
             observed_state_json, prediction_error, surprise, feedback_type, created_at
      FROM rsi_transitions
      WHERE brand_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(brandId, safeLimit) as Array<{
      id: string;
      chat_id: string;
      intent: string;
      action: WorldTransitionRecord['action'];
      state_before_json: string;
      predicted_state_json: string;
      observed_state_json: string;
      prediction_error: number;
      surprise: number;
      feedback_type: WorldTransitionRecord['feedbackType'];
      created_at: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      intent: r.intent,
      action: r.action,
      stateBefore: JSON.parse(r.state_before_json),
      predictedState: JSON.parse(r.predicted_state_json),
      observedState: JSON.parse(r.observed_state_json),
      predictionError: r.prediction_error,
      surprise: r.surprise,
      feedbackType: r.feedback_type,
      createdAt: r.created_at
    }));
  }

  saveWorldWeights(brandId: string, weights: Record<string, FactorWeightDelta>): void {
    const now = Date.now();
    const stmt = this.db.query(`
      INSERT OR REPLACE INTO rsi_world_weights (
        brand_id, transition_key, delta_json, override_prob, sample_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const [key, val] of Object.entries(weights)) {
        stmt.run(brandId, key, JSON.stringify(val.delta), val.overrideProb, val.count, now);
      }
    });
    tx();
  }

  loadWorldWeights(brandId: string): Record<string, FactorWeightDelta> {
    const rows = this.db.query(`
      SELECT transition_key, delta_json, override_prob, sample_count
      FROM rsi_world_weights
      WHERE brand_id = ?
      LIMIT 500
    `).all(brandId) as Array<{
      transition_key: string;
      delta_json: string;
      override_prob: number;
      sample_count: number;
    }>;

    const out: Record<string, FactorWeightDelta> = {};
    for (const r of rows) {
      out[r.transition_key] = {
        delta: JSON.parse(r.delta_json),
        overrideProb: r.override_prob,
        count: r.sample_count
      };
    }
    return out;
  }

  recordGeneration(entry: Omit<RsiGenerationRecord, 'generationId'>): RsiGenerationRecord {
    const cleanSummary = scrubCredentials(entry.mutationSummary);
    const result = this.db.query(`
      INSERT INTO rsi_generations (
        parent_generation_id, brand_id, status, mutation_summary,
        predicted_gain, observed_pass_rate, baseline_pass_rate,
        prediction_error_before, prediction_error_after, opf_diagnostics_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.parentGenerationId,
      entry.brandId,
      entry.status,
      cleanSummary,
      entry.predictedGain,
      entry.observedPassRate,
      entry.baselinePassRate,
      entry.predictionErrorBefore,
      entry.predictionErrorAfter,
      entry.opfDiagnostics ? JSON.stringify(entry.opfDiagnostics) : null,
      entry.createdAt
    );

    return {
      ...entry,
      mutationSummary: cleanSummary,
      generationId: Number(result.lastInsertRowid)
    };
  }

  getLatestPromotedGeneration(brandId: string): RsiGenerationRecord | null {
    const row = this.db.query(`
      SELECT * FROM rsi_generations
      WHERE brand_id = ? AND status = 'promoted'
      ORDER BY generation_id DESC
      LIMIT 1
    `).get(brandId) as Record<string, any> | null;
    return row ? this.mapGenerationRow(row) : null;
  }

  getRecentGenerations(brandId: string, limit = 20): RsiGenerationRecord[] {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const rows = this.db.query(`
      SELECT * FROM rsi_generations
      WHERE brand_id = ?
      ORDER BY generation_id DESC
      LIMIT ?
    `).all(brandId, safeLimit) as Record<string, any>[];
    return rows.map((r) => this.mapGenerationRow(r));
  }

  private mapGenerationRow(r: Record<string, any>): RsiGenerationRecord {
    return {
      generationId: r.generation_id,
      parentGenerationId: r.parent_generation_id ?? null,
      brandId: r.brand_id,
      status: r.status,
      mutationSummary: r.mutation_summary,
      predictedGain: r.predicted_gain,
      observedPassRate: r.observed_pass_rate,
      baselinePassRate: r.baseline_pass_rate,
      predictionErrorBefore: r.prediction_error_before,
      predictionErrorAfter: r.prediction_error_after,
      opfDiagnostics: r.opf_diagnostics_json ? JSON.parse(r.opf_diagnostics_json) : undefined,
      createdAt: r.created_at
    };
  }

  close(): void {
    this.db.close();
  }
}
