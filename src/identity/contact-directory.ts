import { createHash, randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';

export type AliasKind = 'direct_phone' | 'direct_lid' | 'group';
export type AliasSource = 'transport_observation' | 'history_import' | 'owner_verified' | 'provider_verified';
export type VerifiedSource = 'owner_verified' | 'provider_verified';
export type ReviewReason = 'matching_display_name' | 'import_overlap' | 'transport_candidate';

export interface ContactIdentity {
  brandId: string;
  jid: string;
  aliasId: string;
  kind: 'direct' | 'group';
  rawContactId: string;
  contactId: string;
  source: AliasSource;
  confidence: number;
  verifiedAt?: number;
  verified: boolean;
  version: number;
}

export interface RecipientBinding {
  brandId: string;
  jid: string;
  aliasId: string;
  rawContactId: string;
  contactId: string;
  identityVersion: number;
}

export interface MergeDecision {
  id: string;
  winnerContactId: string;
  created: boolean;
  verifiedAt: number;
}

export interface IdentityReview {
  id: string;
  brandId: string;
  firstJid: string;
  secondJid: string;
  reason: ReviewReason;
  state: 'pending' | 'dismissed' | 'verified';
  createdAt: number;
}

export class IdentityEvidenceError extends Error {
  constructor() {
    super('Verified contact identity evidence required');
    this.name = 'IdentityEvidenceError';
  }
}

export class RecipientBindingChangedError extends Error {
  constructor() {
    super('Queued recipient binding changed; revalidation required before sending');
    this.name = 'RecipientBindingChangedError';
  }
}

interface AliasRow {
  id: string;
  brand_id: string;
  jid: string;
  contact_id: string;
  kind: AliasKind;
  source: AliasSource;
  confidence: number;
  verified_at: number | null;
  version: number;
}

interface MergeRow {
  id: string;
  brand_id: string;
  primary_contact_id: string;
  related_contact_id: string;
  primary_jid: string;
  related_jid: string;
  prior_source: AliasSource;
  prior_confidence: number;
  prior_verified_at: number | null;
  verified_at: number;
  active: number;
}

const BRAND_ID = /^[A-Za-z0-9][A-Za-z0-9_:.\-]{0,127}$/;
const EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9_:.\-]{5,127}$/;
const PHONE_JID = /^[0-9]{5,20}@s\.whatsapp\.net$/;
const LID_JID = /^[0-9]{5,20}@lid$/;
const GROUP_JID = /^[0-9]{5,25}(?:\-[0-9]{1,20})?@g\.us$/;
const SOURCES: readonly AliasSource[] = [
  'transport_observation', 'history_import', 'owner_verified', 'provider_verified',
];
const REVIEW_REASONS: readonly ReviewReason[] = [
  'matching_display_name', 'import_overlap', 'transport_candidate',
];

function validatedBrand(brandId: string): string {
  if (typeof brandId !== 'string' || !BRAND_ID.test(brandId)) {
    throw new TypeError('Invalid brand identity');
  }
  return brandId;
}

function validatedJid(jid: string): { jid: string; kind: AliasKind } {
  if (typeof jid !== 'string') throw new TypeError('Invalid WhatsApp identifier');
  const normalized = jid.toLowerCase();
  if (PHONE_JID.test(normalized)) return { jid: normalized, kind: 'direct_phone' };
  if (LID_JID.test(normalized)) return { jid: normalized, kind: 'direct_lid' };
  if (GROUP_JID.test(normalized)) return { jid: normalized, kind: 'group' };
  throw new TypeError('Invalid WhatsApp identifier');
}

function timestamp(now: () => number): number {
  const at = now();
  if (!Number.isSafeInteger(at) || at < 0) throw new RangeError('Invalid identity clock');
  return at;
}

/**
 * S07 identity directory. Alias ownership is immutable: verified joins create
 * reversible edges, never reparenting historical messages or alias rows.
 * Phone/LID equivalence must be supplied by an authenticated provider mapping
 * or explicit owner review, never inferred from names or number fragments.
 */
export class ContactIdentityDirectory {
  private readonly db: Database;
  private readonly now: () => number;

  constructor(options: { dbPath?: string; now?: () => number } = {}) {
    this.db = new Database(options.dbPath ?? ':memory:', { create: true });
    this.now = options.now ?? Date.now;
    this.db.run('PRAGMA foreign_keys=ON');
    this.db.run('PRAGMA journal_mode=WAL');
    this.db.run('PRAGMA busy_timeout=5000');
    this.db.run([
      'CREATE TABLE IF NOT EXISTS identity_contacts (',
      'id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, kind TEXT NOT NULL,',
      'version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)',
    ].join(' '));
    this.db.run([
      'CREATE TABLE IF NOT EXISTS identity_aliases (',
      'id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, jid TEXT NOT NULL,',
      'contact_id TEXT NOT NULL REFERENCES identity_contacts(id),',
      'kind TEXT NOT NULL, source TEXT NOT NULL, confidence REAL NOT NULL,',
      'verified_at INTEGER, created_at INTEGER NOT NULL,',
      'UNIQUE(brand_id, jid))',
    ].join(' '));
    this.db.run('CREATE INDEX IF NOT EXISTS idx_identity_aliases_contact ON identity_aliases(brand_id, contact_id)');
    this.db.run([
      'CREATE TABLE IF NOT EXISTS identity_merges (',
      'id TEXT PRIMARY KEY, brand_id TEXT NOT NULL,',
      'primary_contact_id TEXT NOT NULL REFERENCES identity_contacts(id),',
      'related_contact_id TEXT NOT NULL REFERENCES identity_contacts(id),',
      'primary_jid TEXT NOT NULL, related_jid TEXT NOT NULL,',
      'verification_source TEXT NOT NULL, evidence_sha256 TEXT NOT NULL,',
      'prior_source TEXT NOT NULL, prior_confidence REAL NOT NULL,',
      'prior_verified_at INTEGER, verified_at INTEGER NOT NULL,',
      'active INTEGER NOT NULL DEFAULT 1, undone_at INTEGER)',
    ].join(' '));
    this.db.run([
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_merges_active_child',
      'ON identity_merges(brand_id, related_contact_id) WHERE active=1',
    ].join(' '));
    this.db.run([
      'CREATE TABLE IF NOT EXISTS identity_reviews (',
      'id TEXT PRIMARY KEY, brand_id TEXT NOT NULL,',
      'first_jid TEXT NOT NULL, second_jid TEXT NOT NULL, reason TEXT NOT NULL,',
      'state TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_at INTEGER)',
    ].join(' '));
    this.db.run('CREATE INDEX IF NOT EXISTS idx_identity_reviews_pending ON identity_reviews(brand_id, state, created_at)');
  }

  private atomic<T>(run: () => T): T {
    return this.db.transaction(run).immediate() as unknown as T;
  }

  private alias(brandId: string, jid: string): AliasRow | undefined {
    return this.db.prepare(
      'SELECT a.*, c.version FROM identity_aliases a JOIN identity_contacts c ON c.id=a.contact_id AND c.brand_id=a.brand_id WHERE a.brand_id=? AND a.jid=?',
    ).get(brandId, jid) as AliasRow | undefined;
  }

  private root(brandId: string, originalId: string): string {
    const visited = new Set<string>();
    let id = originalId;
    while (visited.size < 128) {
      if (visited.has(id)) throw new Error('Invalid cyclic identity graph');
      visited.add(id);
      const parent = this.db.prepare(
        'SELECT primary_contact_id AS id FROM identity_merges WHERE brand_id=? AND related_contact_id=? AND active=1',
      ).get(brandId, id) as { id: string } | undefined;
      if (!parent) return id;
      id = parent.id;
    }
    throw new Error('Identity graph exceeds safe depth');
  }

  private membersUnder(brandId: string, id: string): string[] {
    const rows = this.db.prepare([
      'WITH RECURSIVE descendants(id) AS (',
      'SELECT ? UNION',
      'SELECT m.related_contact_id FROM identity_merges m',
      'JOIN descendants d ON m.primary_contact_id=d.id',
      'WHERE m.brand_id=? AND m.active=1',
      ') SELECT id FROM descendants',
    ].join(' ')).all(id, brandId) as Array<{ id: string }>;
    return rows.map(row => row.id);
  }

  private bumpVersions(brandId: string, ids: readonly string[]): void {
    const stmt = this.db.prepare(
      'UPDATE identity_contacts SET version=version+1 WHERE brand_id=? AND id=?',
    );
    for (const id of ids) stmt.run(brandId, id);
  }

  private result(row: AliasRow): ContactIdentity {
    return {
      brandId: row.brand_id,
      jid: row.jid,
      aliasId: row.id,
      kind: row.kind === 'group' ? 'group' : 'direct',
      rawContactId: row.contact_id,
      contactId: this.root(row.brand_id, row.contact_id),
      source: row.source,
      confidence: row.confidence,
      verifiedAt: row.verified_at ?? undefined,
      verified: row.verified_at !== null,
      version: row.version,
    };
  }

  observeAlias(input: {
    brandId: string;
    jid: string;
    displayName?: string;
    source?: 'transport_observation' | 'history_import';
  }): ContactIdentity {
    const brandId = validatedBrand(input.brandId);
    const { jid, kind } = validatedJid(input.jid);
    const source = input.source ?? 'transport_observation';
    if (source !== 'transport_observation' && source !== 'history_import') {
      throw new IdentityEvidenceError();
    }
    // Display names are deliberately not persisted as proof of identity.
    return this.atomic(() => {
      const existing = this.alias(brandId, jid);
      if (existing) return this.result(existing);
      const id = randomUUID();
      const at = timestamp(this.now);
      this.db.prepare(
        'INSERT INTO identity_contacts(id,brand_id,kind,version,created_at) VALUES (?,?,?,1,?)',
      ).run(id, brandId, kind === 'group' ? 'group' : 'direct', at);
      this.db.prepare([
        'INSERT INTO identity_aliases',
        '(id,brand_id,jid,contact_id,kind,source,confidence,verified_at,created_at)',
        'VALUES (?,?,?,?,?,?,0,NULL,?)',
      ].join(' ')).run(randomUUID(), brandId, jid, id, kind, source, at);
      return this.result(this.alias(brandId, jid)!);
    });
  }

  resolve(input: { brandId: string; jid: string }): ContactIdentity | undefined {
    const brandId = validatedBrand(input.brandId);
    const { jid } = validatedJid(input.jid);
    return this.db.transaction(() => {
      const row = this.alias(brandId, jid);
      return row ? this.result(row) : undefined;
    }).deferred() as unknown as ContactIdentity | undefined;
  }

  verifyAliasRelationship(input: {
    brandId: string;
    primaryJid: string;
    relatedJid: string;
    source: VerifiedSource;
    evidenceRef: string;
  }): MergeDecision {
    const brandId = validatedBrand(input.brandId);
    const primaryJid = validatedJid(input.primaryJid).jid;
    const relatedJid = validatedJid(input.relatedJid).jid;
    if ((input.source !== 'owner_verified' && input.source !== 'provider_verified')
        || typeof input.evidenceRef !== 'string' || !EVIDENCE_REF.test(input.evidenceRef)
        || primaryJid === relatedJid) {
      throw new IdentityEvidenceError();
    }
    return this.atomic(() => {
      const primary = this.alias(brandId, primaryJid);
      const related = this.alias(brandId, relatedJid);
      if (!primary || !related || primary.kind === 'group' || related.kind === 'group') {
        throw new IdentityEvidenceError();
      }
      const previous = this.db.prepare([
        'SELECT * FROM identity_merges WHERE brand_id=? AND active=1',
        'AND ((primary_jid=? AND related_jid=?) OR (primary_jid=? AND related_jid=?))',
        'ORDER BY verified_at DESC LIMIT 1',
      ].join(' ')).get(brandId, primaryJid, relatedJid, relatedJid, primaryJid) as MergeRow | undefined;
      const winner = this.root(brandId, primary.contact_id);
      const loser = this.root(brandId, related.contact_id);
      if (winner === loser) {
        const decision = previous ?? this.db.prepare(
          'SELECT * FROM identity_merges WHERE brand_id=? AND active=1 AND (primary_contact_id=? OR related_contact_id=?) ORDER BY verified_at DESC LIMIT 1',
        ).get(brandId, winner, winner) as MergeRow | undefined;
        return { id: decision?.id ?? winner, winnerContactId: winner, created: false, verifiedAt: decision?.verified_at ?? timestamp(this.now) };
      }
      // Stable raw alias ownership lets undo restore the original contact without rewriting any message.
      const affected = this.membersUnder(brandId, loser);
      const id = randomUUID();
      const at = timestamp(this.now);
      const digest = createHash('sha256').update(input.evidenceRef).digest('hex');
      this.db.prepare([
        'INSERT INTO identity_merges',
        '(id,brand_id,primary_contact_id,related_contact_id,primary_jid,related_jid,',
        'verification_source,evidence_sha256,prior_source,prior_confidence,',
        'prior_verified_at,verified_at,active)',
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)',
      ].join(' ')).run(
        id, brandId, primary.contact_id, loser, primaryJid, relatedJid,
        input.source, digest, related.source, related.confidence, related.verified_at, at,
      );
      this.db.prepare(
        'UPDATE identity_aliases SET source=?,confidence=1,verified_at=? WHERE brand_id=? AND jid=?',
      ).run(input.source, at, brandId, relatedJid);
      this.bumpVersions(brandId, affected);
      const [firstJid, secondJid] = [primaryJid, relatedJid].sort();
      this.db.prepare(
        "UPDATE identity_reviews SET state='verified',resolved_at=? WHERE brand_id=? AND first_jid=? AND second_jid=? AND state='pending'",
      ).run(at, brandId, firstJid, secondJid);
      return { id, winnerContactId: winner, created: true, verifiedAt: at };
    });
  }

  undoMerge(input: { brandId: string; decisionId: string }): boolean {
    const brandId = validatedBrand(input.brandId);
    if (typeof input.decisionId !== 'string' || !input.decisionId) return false;
    return this.atomic(() => {
      const decision = this.db.prepare(
        'SELECT * FROM identity_merges WHERE brand_id=? AND id=? AND active=1',
      ).get(brandId, input.decisionId) as MergeRow | undefined;
      if (!decision) return false;
      const affected = this.membersUnder(brandId, decision.related_contact_id);
      this.db.prepare(
        'UPDATE identity_merges SET active=0,undone_at=? WHERE brand_id=? AND id=? AND active=1',
      ).run(timestamp(this.now), brandId, input.decisionId);
      this.db.prepare(
        'UPDATE identity_aliases SET source=?,confidence=?,verified_at=? WHERE brand_id=? AND jid=?',
      ).run(decision.prior_source, decision.prior_confidence, decision.prior_verified_at, brandId, decision.related_jid);
      this.bumpVersions(brandId, affected);
      const [firstJid, secondJid] = [decision.primary_jid, decision.related_jid].sort();
      this.db.prepare(
        "UPDATE identity_reviews SET state='pending',resolved_at=NULL WHERE brand_id=? AND first_jid=? AND second_jid=? AND state='verified'",
      ).run(brandId, firstJid, secondJid);
      return true;
    });
  }

  /** A JSON-serializable immutable recipient reference for the durable send ledger. */
  bindRecipient(input: { brandId: string; jid: string }): RecipientBinding {
    const identity = this.resolve(input);
    if (!identity || identity.kind !== 'direct') {
      throw new RecipientBindingChangedError();
    }
    return Object.freeze({
      brandId: identity.brandId,
      jid: identity.jid,
      aliasId: identity.aliasId,
      rawContactId: identity.rawContactId,
      contactId: identity.contactId,
      identityVersion: identity.version,
    });
  }

  /** Must be called immediately before any WhatsApp network attempt. */
  revalidateRecipient(binding: RecipientBinding): string {
    try {
      if (!binding || !Number.isSafeInteger(binding.identityVersion)
          || binding.identityVersion < 1
          || typeof binding.aliasId !== 'string'
          || typeof binding.rawContactId !== 'string'
          || typeof binding.contactId !== 'string') {
        throw new RecipientBindingChangedError();
      }
      const identity = this.resolve({ brandId: binding.brandId, jid: binding.jid });
      if (!identity || identity.kind !== 'direct'
          || identity.aliasId !== binding.aliasId
          || identity.rawContactId !== binding.rawContactId
          || identity.contactId !== binding.contactId
          || identity.version !== binding.identityVersion) {
        throw new RecipientBindingChangedError();
      }
      return identity.jid;
    } catch {
      throw new RecipientBindingChangedError();
    }
  }

  queueReview(input: {
    brandId: string;
    firstJid: string;
    secondJid: string;
    reason: ReviewReason;
  }): IdentityReview {
    const brandId = validatedBrand(input.brandId);
    const { jid: a, kind: aKind } = validatedJid(input.firstJid);
    const { jid: b, kind: bKind } = validatedJid(input.secondJid);
    if (!REVIEW_REASONS.includes(input.reason)
        || aKind === 'group' || bKind === 'group' || a === b) {
      throw new IdentityEvidenceError();
    }
    return this.atomic(() => {
      const first = this.alias(brandId, a);
      const second = this.alias(brandId, b);
      if (!first || !second || this.root(brandId, first.contact_id) === this.root(brandId, second.contact_id)) {
        throw new IdentityEvidenceError();
      }
      const [firstJid, secondJid] = [a, b].sort();
      const previous = this.db.prepare([
        'SELECT id,brand_id AS brandId,first_jid AS firstJid,second_jid AS secondJid,',
        'reason,state,created_at AS createdAt FROM identity_reviews',
        'WHERE brand_id=? AND first_jid=? AND second_jid=? AND state=?',
        'LIMIT 1',
      ].join(' ')).get(brandId, firstJid, secondJid, 'pending') as IdentityReview | undefined;
      if (previous) return previous;
      const id = randomUUID();
      const at = timestamp(this.now);
      this.db.prepare([
        'INSERT INTO identity_reviews(id,brand_id,first_jid,second_jid,reason,state,created_at)',
        'VALUES (?,?,?,?,?,?,?)',
      ].join(' ')).run(id, brandId, firstJid, secondJid, input.reason, 'pending', at);
      return { id, brandId, firstJid, secondJid, reason: input.reason, state: 'pending', createdAt: at };
    });
  }

  listPendingReviews(brandId: string): IdentityReview[] {
    const brand = validatedBrand(brandId);
    return this.db.prepare([
      'SELECT id,brand_id AS brandId,first_jid AS firstJid,second_jid AS secondJid,',
      'reason,state,created_at AS createdAt FROM identity_reviews',
      'WHERE brand_id=? AND state=? ORDER BY created_at ASC,id ASC',
    ].join(' ')).all(brand, 'pending') as IdentityReview[];
  }

  dismissReview(input: { brandId: string; reviewId: string }): boolean {
    const brandId = validatedBrand(input.brandId);
    if (typeof input.reviewId !== 'string' || !input.reviewId) return false;
    return this.db.prepare(
      'UPDATE identity_reviews SET state=?,resolved_at=? WHERE brand_id=? AND id=? AND state=?',
    ).run('dismissed', timestamp(this.now), brandId, input.reviewId, 'pending').changes === 1;
  }

  close(): void {
    this.db.close();
  }
}
