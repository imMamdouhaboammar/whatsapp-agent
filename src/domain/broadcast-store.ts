import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  BroadcastAudienceFilter,
  BroadcastCampaign,
  BroadcastCampaignStats,
  BroadcastCampaignStatus,
  BroadcastCampaignSummary,
  BroadcastFollowUpConfig,
  BroadcastPacingConfig,
  BroadcastRecipient,
  BroadcastRecipientStatus,
  BroadcastRichContent,
  EligibleContact,
} from './broadcast-types';
import { isRecord, isStringArray, readChoice, readSqliteRow, readSqliteText, readSqliteNumber, readNullableSqliteNumber, readNullableSqliteText } from './sqlite-values';

function decodeJson<T>(raw: string, guard: (value: unknown) => value is T, field: string): T {
  const value: unknown = JSON.parse(raw);
  if (!guard(value)) throw new Error(`Invalid broadcast ${field}`);
  return value;
}

function isAudienceFilter(value: unknown): value is BroadcastAudienceFilter {
  return isRecord(value)
    && (value.query === undefined || typeof value.query === 'string')
    && (value.stages === undefined || isStringArray(value.stages))
    && (value.chatIds === undefined || isStringArray(value.chatIds))
    && (value.excludeOptedOut === undefined || typeof value.excludeOptedOut === 'boolean')
    && ['minMessages', 'activeWithinDays', 'inactiveAtLeastDays', 'limit'].every(key =>
      value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key])));
}

function isRichContent(value: unknown): value is BroadcastRichContent {
  return isRecord(value) && typeof value.messageGoal === 'string'
    && ['text', 'image', 'video', 'document', 'voice_note', 'template'].some(kind => kind === value.kind)
    && ['mediaUrl', 'mediaBase64', 'mimeType', 'fileName', 'templateName',
      'templateLanguage', 'templateHeaderMediaUrl'].every(key => value[key] === undefined || typeof value[key] === 'string')
    && (value.templateHeaderMediaType === undefined || ['image', 'video', 'document'].some(kind => kind === value.templateHeaderMediaType))
    && (value.templateButtons === undefined || (Array.isArray(value.templateButtons)
      && value.templateButtons.every(button => isRecord(button)
        && (button.type === 'url' || button.type === 'quick_reply')
        && typeof button.text === 'string'
        && (button.urlOrPayload === undefined || typeof button.urlOrPayload === 'string'))));
}

function isFollowUp(value: unknown): value is BroadcastFollowUpConfig {
  return isRecord(value) && typeof value.enabled === 'boolean'
    && typeof value.delayMinutes === 'number' && Number.isFinite(value.delayMinutes)
    && typeof value.maxFollowUps === 'number' && Number.isFinite(value.maxFollowUps)
    && (value.triggerOn === 'read_no_reply' || value.triggerOn === 'delivered_no_reply')
    && typeof value.messagePrompt === 'string';
}

function isPacing(value: unknown): value is BroadcastPacingConfig {
  return isRecord(value)
    && typeof value.minDelayMs === 'number' && Number.isFinite(value.minDelayMs)
    && typeof value.maxDelayMs === 'number' && Number.isFinite(value.maxDelayMs)
    && (value.quietHours === undefined || (isRecord(value.quietHours)
      && typeof value.quietHours.from === 'number' && Number.isFinite(value.quietHours.from)
      && typeof value.quietHours.to === 'number' && Number.isFinite(value.quietHours.to)
      && typeof value.quietHours.timeZone === 'string'));
}

interface AudienceRow {
  chat_id: string;
  name: string;
  phone_number: string | null;
  last_timestamp: number | null;
  stage: string;
  facts_json: string;
  preferred_tone: string | null;
  notes: string | null;
  msg_count: number;
  max_msg_ts: number | null;
  last_inbound_ts: number | null;
}

function readAudienceRow(value: unknown): AudienceRow {
  const row = readSqliteRow(value);
  return {
    chat_id: readSqliteText(row, 'chat_id'),
    name: readSqliteText(row, 'name'),
    phone_number: readNullableSqliteText(row, 'phone_number'),
    last_timestamp: readNullableSqliteNumber(row, 'last_timestamp'),
    stage: readSqliteText(row, 'stage'),
    facts_json: readSqliteText(row, 'facts_json'),
    preferred_tone: readNullableSqliteText(row, 'preferred_tone'),
    notes: readNullableSqliteText(row, 'notes'),
    msg_count: readSqliteNumber(row, 'msg_count'),
    max_msg_ts: readNullableSqliteNumber(row, 'max_msg_ts'),
    last_inbound_ts: readNullableSqliteNumber(row, 'last_inbound_ts'),
  };
}

const CAMPAIGN_STATUSES = ['draft', 'approved', 'running', 'paused', 'completed', 'cancelled'] as const;
const RECIPIENT_STATUSES = [
  'draft', 'approved', 'queued', 'sent', 'delivered', 'read', 'replied', 'followed_up', 'skipped', 'failed', 'opted_out',
] as const;

interface CampaignRow {
  id: string;
  name: string;
  goal: string;
  transport: string;
  approval_mode: string;
  status: string;
  audience_filter_json: string;
  rich_content_json: string;
  follow_up_json: string;
  pacing_json: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

function readCampaignRow(value: unknown): CampaignRow {
  const row = readSqliteRow(value);
  return {
    id: readSqliteText(row, 'id'),
    name: readSqliteText(row, 'name'),
    goal: readSqliteText(row, 'goal'),
    transport: readSqliteText(row, 'transport'),
    approval_mode: readSqliteText(row, 'approval_mode'),
    status: readSqliteText(row, 'status'),
    audience_filter_json: readSqliteText(row, 'audience_filter_json'),
    rich_content_json: readSqliteText(row, 'rich_content_json'),
    follow_up_json: readSqliteText(row, 'follow_up_json'),
    pacing_json: readSqliteText(row, 'pacing_json'),
    created_by: readSqliteText(row, 'created_by'),
    created_at: readSqliteNumber(row, 'created_at'),
    updated_at: readSqliteNumber(row, 'updated_at'),
    started_at: readNullableSqliteNumber(row, 'started_at'),
    completed_at: readNullableSqliteNumber(row, 'completed_at'),
  };
}

interface RecipientRow {
  id: string;
  campaign_id: string;
  chat_id: string;
  contact_name: string;
  phone_number: string | null;
  transport_used: string | null;
  personalized_text: string;
  rich_content_json: string;
  status: string;
  provider_message_id: string | null;
  sent_at: number | null;
  delivered_at: number | null;
  read_at: number | null;
  replied_at: number | null;
  follow_up_count: number;
  next_follow_up_at: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function readRecipientRow(value: unknown): RecipientRow {
  const row = readSqliteRow(value);
  return {
    id: readSqliteText(row, 'id'),
    campaign_id: readSqliteText(row, 'campaign_id'),
    chat_id: readSqliteText(row, 'chat_id'),
    contact_name: readSqliteText(row, 'contact_name'),
    phone_number: readNullableSqliteText(row, 'phone_number'),
    transport_used: readNullableSqliteText(row, 'transport_used'),
    personalized_text: readSqliteText(row, 'personalized_text'),
    rich_content_json: readSqliteText(row, 'rich_content_json'),
    status: readSqliteText(row, 'status'),
    provider_message_id: readNullableSqliteText(row, 'provider_message_id'),
    sent_at: readNullableSqliteNumber(row, 'sent_at'),
    delivered_at: readNullableSqliteNumber(row, 'delivered_at'),
    read_at: readNullableSqliteNumber(row, 'read_at'),
    replied_at: readNullableSqliteNumber(row, 'replied_at'),
    follow_up_count: readSqliteNumber(row, 'follow_up_count'),
    next_follow_up_at: readNullableSqliteNumber(row, 'next_follow_up_at'),
    error: readNullableSqliteText(row, 'error'),
    created_at: readSqliteNumber(row, 'created_at'),
    updated_at: readSqliteNumber(row, 'updated_at'),
  };
}

export class BroadcastStore {
  constructor(private readonly db: Database) {
    this.init();
  }

  private init(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS broadcast_campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        goal TEXT NOT NULL,
        transport TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        audience_filter_json TEXT NOT NULL,
        rich_content_json TEXT NOT NULL,
        follow_up_json TEXT NOT NULL,
        pacing_json TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'owner',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_status ON broadcast_campaigns(status, created_at DESC);`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS broadcast_recipients (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        phone_number TEXT,
        transport_used TEXT,
        personalized_text TEXT NOT NULL,
        rich_content_json TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_message_id TEXT,
        sent_at INTEGER,
        delivered_at INTEGER,
        read_at INTEGER,
        replied_at INTEGER,
        follow_up_count INTEGER NOT NULL DEFAULT 0,
        next_follow_up_at INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(campaign_id, chat_id)
      );
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_campaign ON broadcast_recipients(campaign_id, status);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_provider ON broadcast_recipients(provider_message_id);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_followup ON broadcast_recipients(next_follow_up_at);`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS broadcast_opt_outs (
        chat_id TEXT PRIMARY KEY,
        reason TEXT,
        opted_out_at INTEGER NOT NULL
      );
    `);
  }

  private mapCampaign(value: unknown): BroadcastCampaign {
    const row = readCampaignRow(value);
    return {
      id: row.id,
      name: row.name,
      goal: row.goal,
      transport: readChoice(row.transport, ['auto', 'baileys', 'meta-cloud'], 'broadcast transport'),
      approvalMode: readChoice(row.approval_mode, ['preview_approve', 'autonomous'], 'broadcast approval mode'),
      status: readChoice(row.status, CAMPAIGN_STATUSES, 'broadcast campaign status'),
      audienceFilter: decodeJson(row.audience_filter_json, isAudienceFilter, 'audience filter'),
      richContent: decodeJson(row.rich_content_json, isRichContent, 'rich content'),
      followUp: decodeJson(row.follow_up_json, isFollowUp, 'follow-up'),
      pacing: decodeJson(row.pacing_json, isPacing, 'pacing'),
      createdBy: readChoice(row.created_by, ['owner', 'agent'], 'broadcast creator'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
      ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    };
  }

  private mapRecipient(value: unknown): BroadcastRecipient {
    const row = readRecipientRow(value);
    return {
      id: row.id,
      campaignId: row.campaign_id,
      chatId: row.chat_id,
      contactName: row.contact_name,
      ...(row.phone_number ? { phoneNumber: row.phone_number } : {}),
      ...(row.transport_used !== null
        ? { transportUsed: readChoice(row.transport_used, ['baileys', 'meta-cloud'], 'broadcast recipient transport') }
        : {}),
      personalizedText: row.personalized_text,
      richContent: decodeJson(row.rich_content_json, isRichContent, 'rich content'),
      status: readChoice(row.status, RECIPIENT_STATUSES, 'broadcast recipient status'),
      ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
      ...(row.sent_at !== null ? { sentAt: row.sent_at } : {}),
      ...(row.delivered_at !== null ? { deliveredAt: row.delivered_at } : {}),
      ...(row.read_at !== null ? { readAt: row.read_at } : {}),
      ...(row.replied_at !== null ? { repliedAt: row.replied_at } : {}),
      followUpCount: row.follow_up_count,
      ...(row.next_follow_up_at !== null ? { nextFollowUpAt: row.next_follow_up_at } : {}),
      ...(row.error ? { error: row.error } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Finds contacts who have an established previous connection with the business
   * (non-group chats with at least one prior message or recorded interaction).
   */
  findEligibleAudience(filter: BroadcastAudienceFilter = {}, now = Date.now()): EligibleContact[] {
    const excludeOptedOut = filter.excludeOptedOut !== false;
    const minMessages = Math.max(1, filter.minMessages ?? 1);
    const limit = Math.min(Math.max(1, filter.limit ?? 100), 500);

    const rows = this.db.query<unknown, [number]>(`
      SELECT
        c.id AS chat_id,
        c.name AS name,
        c.phone_number AS phone_number,
        c.last_timestamp AS last_timestamp,
        COALESCE(d.stage, 'lead') AS stage,
        COALESCE(d.facts_json, '[]') AS facts_json,
        d.preferred_tone AS preferred_tone,
        d.notes AS notes,
        (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS msg_count,
        (SELECT MAX(m.timestamp) FROM messages m WHERE m.chat_id = c.id) AS max_msg_ts,
        (SELECT MAX(m.timestamp) FROM messages m WHERE m.chat_id = c.id AND m.is_from_me = 0) AS last_inbound_ts
      FROM chats c
      LEFT JOIN contact_dossiers d ON d.chat_id = c.id
      LEFT JOIN broadcast_opt_outs o ON o.chat_id = c.id
      WHERE c.is_group = 0
        AND (? = 0 OR o.chat_id IS NULL)
      ORDER BY COALESCE(c.last_timestamp, 0) DESC
      LIMIT 500
    `).all(excludeOptedOut ? 1 : 0);

    const stagesFilter = filter.stages?.length ? new Set(filter.stages.map((s) => s.toLowerCase())) : null;
    const chatIdsFilter = filter.chatIds?.length ? new Set(filter.chatIds) : null;
    const queryTerms = filter.query?.trim()
      ? filter.query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2)
      : [];

    const results: EligibleContact[] = [];
    for (const value of rows) {
      const row = readAudienceRow(value);
      const hasConnection = row.msg_count >= minMessages || (minMessages <= 1 && row.last_timestamp !== null);
      if (!hasConnection) continue;
      if (chatIdsFilter && !chatIdsFilter.has(row.chat_id)) continue;
      if (stagesFilter && !stagesFilter.has(row.stage.toLowerCase())) continue;

      const lastActivity = row.max_msg_ts ?? row.last_timestamp ?? undefined;
      if (filter.activeWithinDays !== undefined && lastActivity !== undefined) {
        const cutoff = now - filter.activeWithinDays * 86_400_000;
        if (lastActivity < cutoff) continue;
      }
      if (filter.inactiveAtLeastDays !== undefined && lastActivity !== undefined) {
        const cutoff = now - filter.inactiveAtLeastDays * 86_400_000;
        if (lastActivity > cutoff) continue;
      }

      const memRows = this.db
        .query<unknown, [string]>('SELECT content FROM contact_memories WHERE jid = ? ORDER BY created_at DESC LIMIT 10')
        .all(row.chat_id);
      const memories = memRows.map(memoryRow => readSqliteText(readSqliteRow(memoryRow), 'content'));
      let facts: string[] = [];
      try {
        const parsedFacts: unknown = JSON.parse(row.facts_json);
        if (isStringArray(parsedFacts)) facts = parsedFacts;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }

      if (queryTerms.length > 0) {
        const searchable = [
          row.name,
          row.phone_number ?? '',
          row.stage,
          row.notes ?? '',
          ...facts,
          ...memories,
        ].join(' ').toLowerCase();
        const matches = queryTerms.some((term) => searchable.includes(term));
        if (!matches) continue;
      }

      results.push({
        chatId: row.chat_id,
        name: row.name,
        ...(row.phone_number ? { phoneNumber: row.phone_number } : {}),
        stage: row.stage,
        facts,
        ...(row.preferred_tone ? { preferredTone: row.preferred_tone } : {}),
        ...(row.notes ? { notes: row.notes } : {}),
        memories,
        messageCount: row.msg_count,
        ...(lastActivity !== undefined ? { lastMessageAtMs: lastActivity } : {}),
        ...(row.last_inbound_ts !== null ? { lastInboundAtMs: row.last_inbound_ts } : {}),
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  markOptOut(chatId: string, reason = 'user_requested', now = Date.now()): void {
    this.db.query(`
      INSERT INTO broadcast_opt_outs (chat_id, reason, opted_out_at)
      VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET reason = excluded.reason, opted_out_at = excluded.opted_out_at
    `).run(chatId, reason, now);

    this.db.query(`
      UPDATE broadcast_recipients
      SET status = 'opted_out', next_follow_up_at = NULL, updated_at = ?
      WHERE chat_id = ? AND status IN ('draft', 'approved', 'queued', 'sent', 'delivered', 'read')
    `).run(now, chatId);
  }

  isOptedOut(chatId: string): boolean {
    const row = this.db.query('SELECT 1 FROM broadcast_opt_outs WHERE chat_id = ? LIMIT 1').get(chatId);
    return row !== null;
  }

  createCampaign(input: Omit<BroadcastCampaign, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): BroadcastCampaign {
    const now = Date.now();
    const id = input.id ?? randomUUID();
    this.db.query(`
      INSERT INTO broadcast_campaigns (
        id, name, goal, transport, approval_mode, status,
        audience_filter_json, rich_content_json, follow_up_json, pacing_json,
        created_by, created_at, updated_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.goal,
      input.transport,
      input.approvalMode,
      input.status,
      JSON.stringify(input.audienceFilter),
      JSON.stringify(input.richContent),
      JSON.stringify(input.followUp),
      JSON.stringify(input.pacing),
      input.createdBy,
      now,
      now,
      input.startedAt ?? null,
      input.completedAt ?? null
    );
    const created = this.getCampaign(id);
    if (!created) throw new Error(`Failed to load created broadcast campaign ${id}`);
    return created;
  }

  getCampaign(campaignId: string): BroadcastCampaign | null {
    const row = this.db
      .query<unknown, [string]>('SELECT * FROM broadcast_campaigns WHERE id = ? LIMIT 1')
      .get(campaignId);
    return row ? this.mapCampaign(row) : null;
  }

  listCampaigns(limit = 50): BroadcastCampaignSummary[] {
    const rows = this.db
      .query<unknown, [number]>('SELECT * FROM broadcast_campaigns ORDER BY created_at DESC LIMIT ?')
      .all(Math.min(Math.max(1, limit), 200));
    return rows.map((row) => {
      const campaign = this.mapCampaign(row);
      return Object.assign(campaign, { stats: this.getCampaignStats(campaign.id) });
    });
  }

  updateCampaignStatus(campaignId: string, status: BroadcastCampaignStatus, timestamps?: { startedAt?: number; completedAt?: number }): BroadcastCampaign | null {
    const now = Date.now();
    this.db.query(`
      UPDATE broadcast_campaigns
      SET status = ?,
          updated_at = ?,
          started_at = COALESCE(?, started_at),
          completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `).run(status, now, timestamps?.startedAt ?? null, timestamps?.completedAt ?? null, campaignId);
    return this.getCampaign(campaignId);
  }

  addRecipients(
    campaignId: string,
    recipients: Array<{
      chatId: string;
      contactName: string;
      phoneNumber?: string;
      personalizedText: string;
      richContent: BroadcastRichContent;
      status: BroadcastRecipientStatus;
    }>
  ): BroadcastRecipient[] {
    const now = Date.now();
    const insert = this.db.query(`
      INSERT OR IGNORE INTO broadcast_recipients (
        id, campaign_id, chat_id, contact_name, phone_number,
        personalized_text, rich_content_json, status, follow_up_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const r of recipients) {
        insert.run(
          randomUUID(),
          campaignId,
          r.chatId,
          r.contactName,
          r.phoneNumber ?? null,
          r.personalizedText,
          JSON.stringify(r.richContent),
          r.status,
          now,
          now
        );
      }
    });
    tx();
    return this.listRecipients(campaignId);
  }

  listRecipients(campaignId: string): BroadcastRecipient[] {
    const rows = this.db
      .query<unknown, [string]>('SELECT * FROM broadcast_recipients WHERE campaign_id = ? ORDER BY created_at ASC')
      .all(campaignId);
    return rows.map((row) => this.mapRecipient(row));
  }

  getRecipient(recipientId: string): BroadcastRecipient | null {
    const row = this.db
      .query<unknown, [string]>('SELECT * FROM broadcast_recipients WHERE id = ? LIMIT 1')
      .get(recipientId);
    return row ? this.mapRecipient(row) : null;
  }

  updateRecipientDraft(recipientId: string, patch: { personalizedText?: string; status?: 'draft' | 'approved' | 'skipped' }): BroadcastRecipient | null {
    const now = Date.now();
    const current = this.getRecipient(recipientId);
    if (!current) return null;
    this.db.query(`
      UPDATE broadcast_recipients
      SET personalized_text = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      patch.personalizedText ?? current.personalizedText,
      patch.status ?? current.status,
      now,
      recipientId
    );
    return this.getRecipient(recipientId);
  }

  approveAllDraftRecipients(campaignId: string): void {
    this.db.query(`
      UPDATE broadcast_recipients
      SET status = 'approved', updated_at = ?
      WHERE campaign_id = ? AND status = 'draft'
    `).run(Date.now(), campaignId);
  }

  updateRecipientDelivery(
    recipientId: string,
    patch: {
      status: BroadcastRecipientStatus;
      transportUsed?: 'baileys' | 'meta-cloud';
      providerMessageId?: string;
      sentAt?: number;
      deliveredAt?: number;
      readAt?: number;
      repliedAt?: number;
      followUpCount?: number;
      nextFollowUpAt?: number | null;
      error?: string | null;
    }
  ): BroadcastRecipient | null {
    const current = this.getRecipient(recipientId);
    if (!current) return null;
    const now = Date.now();
    this.db.query(`
      UPDATE broadcast_recipients
      SET status = ?,
          transport_used = COALESCE(?, transport_used),
          provider_message_id = COALESCE(?, provider_message_id),
          sent_at = COALESCE(?, sent_at),
          delivered_at = COALESCE(?, delivered_at),
          read_at = COALESCE(?, read_at),
          replied_at = COALESCE(?, replied_at),
          follow_up_count = COALESCE(?, follow_up_count),
          next_follow_up_at = ?,
          error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      patch.status,
      patch.transportUsed ?? null,
      patch.providerMessageId ?? null,
      patch.sentAt ?? null,
      patch.deliveredAt ?? null,
      patch.readAt ?? null,
      patch.repliedAt ?? null,
      patch.followUpCount ?? null,
      patch.nextFollowUpAt === undefined ? (current.nextFollowUpAt ?? null) : patch.nextFollowUpAt,
      patch.error === undefined ? (current.error ?? null) : patch.error,
      now,
      recipientId
    );
    return this.getRecipient(recipientId);
  }

  findRecipientByProviderMessageId(providerMessageId: string): BroadcastRecipient | null {
    const row = this.db
      .query<unknown, [string]>('SELECT * FROM broadcast_recipients WHERE provider_message_id = ? LIMIT 1')
      .get(providerMessageId);
    return row ? this.mapRecipient(row) : null;
  }

  findActiveRecipientsForChat(chatId: string): BroadcastRecipient[] {
    const rows = this.db.query<unknown, [string]>(`
      SELECT * FROM broadcast_recipients
      WHERE chat_id = ? AND status IN ('sent', 'delivered', 'read', 'followed_up')
      ORDER BY sent_at DESC
    `).all(chatId);
    return rows.map((row) => this.mapRecipient(row));
  }

  findDueFollowUps(now = Date.now(), limit = 25): BroadcastRecipient[] {
    const rows = this.db.query<unknown, [number, number]>(`
      SELECT r.* FROM broadcast_recipients r
      INNER JOIN broadcast_campaigns c ON c.id = r.campaign_id
      WHERE r.next_follow_up_at IS NOT NULL
        AND r.next_follow_up_at <= ?
        AND r.replied_at IS NULL
        AND r.status IN ('delivered', 'read', 'followed_up')
        AND c.status IN ('running', 'completed')
      ORDER BY r.next_follow_up_at ASC
      LIMIT ?
    `).all(now, limit);
    return rows.map((row) => this.mapRecipient(row));
  }

  getCampaignStats(campaignId: string): BroadcastCampaignStats {
    const rows = this.db.query<unknown, [string]>(`
      SELECT status, COUNT(*) AS cnt
      FROM broadcast_recipients
      WHERE campaign_id = ?
      GROUP BY status
    `).all(campaignId);

    const stats: BroadcastCampaignStats = {
      total: 0,
      draft: 0,
      approved: 0,
      queued: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      followedUp: 0,
      skipped: 0,
      failed: 0,
      optedOut: 0,
    };

    for (const value of rows) {
      const r = readSqliteRow(value);
      const count = readSqliteNumber(r, 'cnt');
      stats.total += count;
      switch (readChoice(r.status, RECIPIENT_STATUSES, 'broadcast recipient status')) {
        case 'draft': stats.draft = count; break;
        case 'approved': stats.approved = count; break;
        case 'queued': stats.queued = count; break;
        case 'sent': stats.sent = count; break;
        case 'delivered': stats.delivered = count; break;
        case 'read': stats.read = count; break;
        case 'replied': stats.replied = count; break;
        case 'followed_up': stats.followedUp = count; break;
        case 'skipped': stats.skipped = count; break;
        case 'failed': stats.failed = count; break;
        case 'opted_out': stats.optedOut = count; break;
      }
    }
    return stats;
  }
}
