import { scrubCredentials } from './credential-scrubber';

export type HarnessScope = 'local' | 'global';
export type HarnessEntryKind = 'rule' | 'best_practice' | 'tactic' | 'memory';

export interface ContinualHarnessEntry {
  id: string;
  kind: HarnessEntryKind;
  scope: HarnessScope;
  chatId?: string;
  title: string;
  content: string;
  tags: string[];
  evidence: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface HarnessEdit {
  action: 'create' | 'update' | 'delete';
  kind: HarnessEntryKind;
  scope: HarnessScope;
  chatId?: string;
  id?: string;
  title?: string;
  content?: string;
  tags?: string[];
  evidence?: string;
}

export interface HarnessSnapshot {
  generationId: string;
  createdAt: number;
  entries: ContinualHarnessEntry[];
}

function normalizeArabicToken(token: string): string {
  return token.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

function isArabicToken(token: string): boolean {
  return /[\u0600-\u06FF]/.test(token);
}

/**
 * Bilingual (Arabic + Latin) query tokenizer inspired by Prime Agent's harness_query_terms.
 * Retains Latin tokens >= 3 chars and Arabic tokens >= 2 chars (normalized).
 */
export function tokenizeHarnessQuery(text: string): string[] {
  if (!text) return [];
  const rawRuns = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const raw of rawRuns) {
    const token = isArabicToken(raw) ? normalizeArabicToken(raw) : raw;
    const minLen = isArabicToken(token) ? 2 : 3;
    if (token.length < minLen) continue;
    if (!seen.has(token)) {
      seen.add(token);
      terms.push(token);
    }
  }
  return terms;
}

/**
 * Inverse document frequency per query term over a corpus of harness entries:
 * ln(1 + N / df) — distinctive terms outrank ubiquitous ones.
 */
export function computeHarnessIdf(entries: ContinualHarnessEntry[], terms: string[]): Map<string, number> {
  const idf = new Map<string, number>();
  if (terms.length === 0 || entries.length === 0) return idf;

  for (const term of terms) {
    let df = 0;
    for (const entry of entries) {
      const hay = normalizeArabicToken(
        `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase()
      );
      if (hay.includes(term)) df++;
    }
    if (df > 0) {
      idf.set(term, Math.log(1 + entries.length / df));
    }
  }
  return idf;
}

/**
 * Scores one harness entry against query terms using multi-field coverage and IDF weighting.
 */
export function scoreHarnessEntry(
  entry: ContinualHarnessEntry,
  terms: string[],
  idf: Map<string, number>
): number {
  if (terms.length === 0) return 0;
  const title = normalizeArabicToken(entry.title.toLowerCase());
  const content = normalizeArabicToken(entry.content.toLowerCase());
  const tags = normalizeArabicToken(entry.tags.join(' ').toLowerCase());

  let score = 0;
  for (const term of terms) {
    let fields = 0;
    if (title.includes(term)) fields++;
    if (content.includes(term)) fields++;
    if (tags.includes(term)) fields++;
    if (fields > 0) {
      const termIdf = idf.get(term) ?? 1;
      score += termIdf * (1 + (fields - 1) * 0.5);
    }
  }
  return score;
}

/**
 * Manages granular, versioned, scope-isolated continual harness entries with
 * IDF relevance ranking and snapshot-based rollback.
 */
export class ContinualHarnessStore {
  private entries = new Map<string, ContinualHarnessEntry>();
  private snapshots: HarnessSnapshot[] = [];
  private static readonly MAX_SNAPSHOTS = 25;
  private seq = 0;

  listEntries(filter?: { scope?: HarnessScope; kind?: HarnessEntryKind; chatId?: string }): ContinualHarnessEntry[] {
    const out: ContinualHarnessEntry[] = [];
    for (const entry of this.entries.values()) {
      if (filter?.scope && entry.scope !== filter.scope) continue;
      if (filter?.kind && entry.kind !== filter.kind) continue;
      if (filter?.chatId !== undefined && entry.scope === 'local' && entry.chatId !== filter.chatId) continue;
      out.push({ ...entry, tags: [...entry.tags] });
    }
    return out;
  }

  /**
   * Ranks entries by relevance to queryText (using IDF) while falling back to recency/version.
   */
  rankEntries(
    queryText: string,
    options: { scope?: HarnessScope; kind?: HarnessEntryKind; chatId?: string; limit?: number } = {}
  ): ContinualHarnessEntry[] {
    const pool = this.listEntries({
      scope: options.scope,
      kind: options.kind,
      chatId: options.chatId
    }).filter((e) => e.scope === 'global' || (options.chatId && e.chatId === options.chatId));

    const terms = tokenizeHarnessQuery(queryText);
    const idf = computeHarnessIdf(pool, terms);

    const scored = pool.map((entry) => ({
      entry,
      score: terms.length > 0 ? scoreHarnessEntry(entry, terms, idf) : 0
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.entry.updatedAt - a.entry.updatedAt;
    });

    const limit = options.limit ?? pool.length;
    return scored.slice(0, Math.max(0, limit)).map((s) => s.entry);
  }

  /**
   * Saves a point-in-time snapshot before applying a batch of edits so faulty
   * refinements can be rolled back atomically.
   */
  takeSnapshot(generationId: string): HarnessSnapshot {
    const entries: ContinualHarnessEntry[] = [];
    for (const e of this.entries.values()) {
      entries.push({ ...e, tags: [...e.tags] });
    }
    const snapshot: HarnessSnapshot = {
      generationId,
      createdAt: Date.now(),
      entries
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > ContinualHarnessStore.MAX_SNAPSHOTS) {
      this.snapshots.shift();
    }
    return snapshot;
  }

  rollbackToSnapshot(generationId: string): boolean {
    const idx = this.snapshots.findIndex((s) => s.generationId === generationId);
    if (idx === -1) return false;
    const snap = this.snapshots[idx];
    if (!snap) return false;
    this.entries.clear();
    for (const entry of snap.entries) {
      this.entries.set(entry.id, { ...entry, tags: [...entry.tags] });
    }
    return true;
  }

  /**
   * Applies a granular Create / Update / Delete edit with credential scrubbing.
   */
  applyEdit(edit: HarnessEdit): { applied: boolean; entry?: ContinualHarnessEntry; reason?: string } {
    if (edit.scope === 'local' && !edit.chatId) {
      return { applied: false, reason: 'Local harness edit requires chatId' };
    }

    const now = Date.now();
    if (edit.action === 'delete') {
      const existing = edit.id ? this.entries.get(edit.id) : undefined;
      if (!edit.id || !existing) {
        return { applied: false, reason: 'Target entry not found for delete' };
      }
      if (existing.scope !== edit.scope || (edit.scope === 'local' && existing.chatId !== edit.chatId)) {
        return { applied: false, reason: 'Scope/chatId mismatch on delete' };
      }
      this.entries.delete(edit.id);
      return { applied: true, entry: existing };
    }

    const cleanContent = scrubCredentials((edit.content ?? '').trim());
    const cleanTitle = scrubCredentials((edit.title ?? cleanContent.slice(0, 60)).trim());
    const cleanEvidence = scrubCredentials((edit.evidence ?? '').trim());
    if (!cleanContent) {
      return { applied: false, reason: 'Empty content' };
    }

    if (edit.action === 'update') {
      const existing = edit.id ? this.entries.get(edit.id) : undefined;
      if (!edit.id || !existing) {
        return { applied: false, reason: 'Target entry not found for update' };
      }
      if (existing.scope !== edit.scope || (edit.scope === 'local' && existing.chatId !== edit.chatId)) {
        return { applied: false, reason: 'Scope/chatId mismatch on update' };
      }
      const updated: ContinualHarnessEntry = {
        ...existing,
        title: cleanTitle || existing.title,
        content: cleanContent,
        tags: (edit.tags ?? existing.tags).map((t) => scrubCredentials(t.trim())).filter(Boolean),
        evidence: cleanEvidence || existing.evidence,
        version: existing.version + 1,
        updatedAt: now
      };
      this.entries.set(updated.id, updated);
      return { applied: true, entry: { ...updated, tags: [...updated.tags] } };
    }

    // Create (deduplicate by kind + scope + chatId + normalized content)
    const normContent = cleanContent.toLowerCase();
    for (const existing of this.entries.values()) {
      if (
        existing.kind === edit.kind &&
        existing.scope === edit.scope &&
        existing.chatId === edit.chatId &&
        existing.content.toLowerCase() === normContent
      ) {
        return { applied: false, reason: 'Duplicate entry content' };
      }
    }

    this.seq += 1;
    const id = edit.id?.trim() || `${edit.scope}_${edit.kind}_${now}_${this.seq}`;
    const created: ContinualHarnessEntry = {
      id,
      kind: edit.kind,
      scope: edit.scope,
      chatId: edit.scope === 'local' ? edit.chatId : undefined,
      title: cleanTitle,
      content: cleanContent,
      tags: (edit.tags ?? []).map((t) => scrubCredentials(t.trim())).filter(Boolean),
      evidence: cleanEvidence,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.entries.set(id, created);
    return { applied: true, entry: { ...created, tags: [...created.tags] } };
  }
}
