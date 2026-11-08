import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Official Meta Cloud API transport. It does not own the S01 send ledger:
 * callers must persist/claim a durable intent before invoking sendText/sendTemplate.
 */
export interface MetaCloudApiConfig {
  graphVersion: string;
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  webhookVerifyToken: string;
  businessAccountId?: string;
}
export interface MetaCloudSendAccepted { messageId: string }
export interface MetaCloudTemplateComponent {
  type: 'header' | 'body';
  parameters: Array<{ type: 'text'; text: string }>;
}
export interface MetaCloudTemplateRequest {
  to: string;
  template: { name: string; languageCode: string; components?: MetaCloudTemplateComponent[] };
  eligibility: { optedInAtMs: number; approvedTemplate: boolean };
}
export interface MetaCloudTextRequest {
  to: string;
  text: string;
  lastInboundAtMs: number;
}
export type MetaCloudWebhookEvent =
  | { kind: 'receipt'; chatId: string; nativeMessageId: string; status: 'sent' | 'delivered' | 'read' }
  | { kind: 'delivery_failed'; chatId: string; nativeMessageId: string }
  | { kind: 'inbound_text'; chatId: string; nativeMessageId: string; text: string; timestampMs: number };

export class MetaCloudTransportError extends Error {
  readonly code = 'WHATSAPP_ACCEPTANCE_AMBIGUOUS';
  constructor(message = 'Meta Cloud API acceptance could not be confirmed') {
    super(message);
    this.name = 'MetaCloudTransportError';
  }
}

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WEBHOOK_BYTES = 1_048_576;
const MAX_WEBHOOK_EVENTS = 500;
const MAX_RECENT_EVENTS = 10_000;
// Meta IDs may use either Base64 (including padding) or URL-safe characters.
const META_MESSAGE_ID = /^wamid[.][A-Za-z0-9_+\-./:]{1,510}={0,2}$/;
const PHONE_NUMBER = /^\d{6,15}$/;
const CLOUD_JID = /^(\d{6,15})@s[.]whatsapp[.]net$/;
const TEMPLATE_NAME = /^[a-z][a-z0-9_]{0,511}$/;
const TEMPLATE_LANGUAGE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;

function recipientNumber(value: string): string {
  const fromJid = value.match(CLOUD_JID);
  const phone = fromJid?.[1] ?? value;
  if (!PHONE_NUMBER.test(phone)) throw new TypeError('Meta recipient must be a verified direct phone number');
  return phone;
}

function validTimestamp(value: number, now: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= now;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function secureTokenEqual(actual: string, expected: string): boolean {
  const provided = createHmac('sha256', 'meta-webhook-verification').update(actual).digest();
  const configured = createHmac('sha256', 'meta-webhook-verification').update(expected).digest();
  return timingSafeEqual(provided, configured);
}

function signedEventKey(event: MetaCloudWebhookEvent): string {
  return [event.kind, event.chatId, event.nativeMessageId,
    event.kind === 'receipt' ? event.status : ''].join(':');
}

function textParameter(component: MetaCloudTemplateComponent): MetaCloudTemplateComponent {
  if (!['header', 'body'].includes(component.type) ||
      !Array.isArray(component.parameters) || component.parameters.length > 16) {
    throw new TypeError('Unsupported template component');
  }
  return {
    type: component.type,
    parameters: component.parameters.map(parameter => {
      if (parameter?.type !== 'text' || typeof parameter.text !== 'string' ||
          !parameter.text.trim() || parameter.text.length > 1024) {
        throw new TypeError('Unsupported template parameter');
      }
      return { type: 'text', text: parameter.text };
    })
  };
}

export class MetaCloudApi {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly recentlyHandled = new Map<string, true>();
  private dispatchTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: {
    config: MetaCloudApiConfig;
    fetch?: typeof fetch;
    now?: () => number;
    onEvent?: (event: MetaCloudWebhookEvent) => void | Promise<void>;
  }) {
    const config = options.config;
    if (!/^v\d{1,2}[.]\d{1,2}$/.test(config.graphVersion) ||
        !/^\d{5,20}$/.test(config.phoneNumberId) ||
        typeof config.accessToken !== 'string' || !config.accessToken.trim() ||
        typeof config.appSecret !== 'string' || !config.appSecret.trim() ||
        typeof config.webhookVerifyToken !== 'string' || !config.webhookVerifyToken.trim()) {
      throw new TypeError('Invalid Meta Cloud API configuration');
    }
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async sendText(request: MetaCloudTextRequest): Promise<MetaCloudSendAccepted> {
    const to = recipientNumber(request.to);
    const now = this.now();
    if (!validTimestamp(request.lastInboundAtMs, now) ||
        now - request.lastInboundAtMs >= SERVICE_WINDOW_MS) {
      throw new Error('A verified recent customer message is required for free-form text');
    }
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 4096) {
      throw new TypeError('Invalid Meta text message');
    }
    return this.send({
      messaging_product: 'whatsapp', to, type: 'text',
      text: { body: request.text, preview_url: false }
    });
  }

  async sendTemplate(request: MetaCloudTemplateRequest): Promise<MetaCloudSendAccepted> {
    const to = recipientNumber(request.to);
    if (!request.eligibility?.approvedTemplate ||
        !validTimestamp(request.eligibility.optedInAtMs, this.now())) {
      throw new Error('Approved template and prior customer opt-in evidence are required');
    }
    const { name, languageCode, components } = request.template ?? {};
    if (typeof name !== 'string' || !TEMPLATE_NAME.test(name) ||
        typeof languageCode !== 'string' || !TEMPLATE_LANGUAGE.test(languageCode)) {
      throw new TypeError('Invalid approved template identifier');
    }
    const sanitized = components?.map(textParameter);
    return this.send({
      messaging_product: 'whatsapp', to, type: 'template',
      template: {
        name, language: { code: languageCode },
        ...(sanitized?.length ? { components: sanitized } : {})
      }
    });
  }

  private async send(body: unknown): Promise<MetaCloudSendAccepted> {
    const { graphVersion, phoneNumberId, accessToken } = this.options.config;
    const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      // A network failure after issuing a request cannot establish non-acceptance.
      throw new MetaCloudTransportError();
    }
    if (!response.ok) {
      // Do not echo provider error bodies, tokens, arbitrary user data, or URL parameters.
      throw new MetaCloudTransportError(`Meta Cloud API returned HTTP ${response.status}`);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new MetaCloudTransportError();
    }
    const id = (data as { messages?: Array<{ id?: unknown }> })?.messages?.[0]?.id;
    if (typeof id !== 'string' || !META_MESSAGE_ID.test(id)) {
      throw new MetaCloudTransportError();
    }
    return { messageId: id };
  }

  handleWebhookGet(request: Request): Response {
    const params = new URL(request.url).searchParams;
    const mode = params.get('hub.mode');
    const token = params.get('hub.verify_token');
    const challenge = params.get('hub.challenge');
    if (mode !== 'subscribe' || !token || !challenge || challenge.length > 1024 ||
        !secureTokenEqual(token, this.options.config.webhookVerifyToken)) {
      return new Response('Forbidden', { status: 403 });
    }
    return new Response(challenge, {
      status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  async handleWebhookPost(request: Request): Promise<Response> {
    const configuredWaba = this.options.config.businessAccountId;
    // The webhook may contain multiple phone numbers under one WABA.
    // Without both identifiers we cannot safely route a multi-brand event.
    if (!configuredWaba) return new Response('Webhook identity is not configured', { status: 503 });

    const length = request.headers.get('content-length');
    if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_WEBHOOK_BYTES) {
      return new Response('Payload too large', { status: 413 });
    }
    if (!request.body) return new Response('Empty webhook', { status: 400 });
    const reader = request.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_WEBHOOK_BYTES) {
          await reader.cancel();
          return new Response('Payload too large', { status: 413 });
        }
        chunks.push(Buffer.from(value));
      }
    } catch {
      return new Response('Unable to read webhook', { status: 400 });
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks, totalBytes);

    // Verify HMAC on the exact unparsed bytes, before any JSON decoding.
    const provided = request.headers.get('x-hub-signature-256');
    if (!provided || !/^sha256=[0-9a-fA-F]{64}$/.test(provided)) {
      return new Response('Unauthorized', { status: 401 });
    }
    const digest = createHmac('sha256', this.options.config.appSecret).update(bytes).digest();
    const submitted = Buffer.from(provided.slice('sha256='.length), 'hex');
    if (!timingSafeEqual(digest, submitted)) {
      return new Response('Unauthorized', { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(bytes.toString('utf8'));
    } catch {
      return new Response('Malformed JSON', { status: 400 });
    }
    const root = record(payload);
    if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) {
      return new Response('Invalid webhook envelope', { status: 400 });
    }

    const events: MetaCloudWebhookEvent[] = [];
    for (const rawEntry of root.entry) {
      const entry = record(rawEntry);
      if (!entry || !Array.isArray(entry.changes)) {
        return new Response('Invalid webhook entry', { status: 400 });
      }
      if (entry.id !== configuredWaba) {
        return new Response('Webhook identity mismatch', { status: 403 });
      }
      for (const rawChange of entry.changes) {
        const change = record(rawChange);
        if (!change) return new Response('Invalid webhook change', { status: 400 });
        if (change.field !== 'messages') continue;
        const value = record(change.value);
        const metadata = record(value?.metadata);
        if (metadata?.phone_number_id !== this.options.config.phoneNumberId) {
          return new Response('Webhook identity mismatch', { status: 403 });
        }

        for (const rawMessage of safeArray(value?.messages)) {
          const message = record(rawMessage);
          const text = record(message?.text);
          const timestamp = message?.timestamp;
          const timestampMs = Number(timestamp) * 1000;
          if (message?.type !== 'text' || typeof message?.id !== 'string' ||
              !META_MESSAGE_ID.test(message.id) || typeof message.from !== 'string' ||
              !PHONE_NUMBER.test(message.from) || typeof text?.body !== 'string' ||
              !text.body || typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp) ||
              !Number.isSafeInteger(timestampMs) || timestampMs <= 0) continue;
          events.push({
            kind: 'inbound_text', chatId: `${message.from}@s.whatsapp.net`,
            nativeMessageId: message.id, text: text.body, timestampMs
          });
        }

        for (const rawStatus of safeArray(value?.statuses)) {
          const status = record(rawStatus);
          if (typeof status?.id !== 'string' || !META_MESSAGE_ID.test(status.id) ||
              typeof status.recipient_id !== 'string' || !PHONE_NUMBER.test(status.recipient_id)) continue;
          const chatId = `${status.recipient_id}@s.whatsapp.net`;
          if (status.status === 'sent' || status.status === 'delivered' || status.status === 'read') {
            events.push({ kind: 'receipt', chatId, nativeMessageId: status.id, status: status.status });
          } else if (status.status === 'failed') {
            // Failure carries no S01 delivery success transition and must be handled separately.
            events.push({ kind: 'delivery_failed', chatId, nativeMessageId: status.id });
          }
        }
        if (events.length > MAX_WEBHOOK_EVENTS) {
          return new Response('Too many webhook events', { status: 413 });
        }
      }
    }

    if (events.length && !this.options.onEvent) {
      // Do not ACK messages that nobody will persist: Meta should retry.
      return new Response('Webhook handler unavailable', { status: 503 });
    }

    // Serialize callback dispatch so simultaneous retries cannot process an event twice.
    const previous = this.dispatchTail;
    let release!: () => void;
    this.dispatchTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      for (const event of events) {
        const key = signedEventKey(event);
        if (this.recentlyHandled.has(key)) continue;
        try {
          await this.options.onEvent?.(event);
        } catch {
          // Callback failure must not mark the event handled.
          return new Response('Webhook processing unavailable', { status: 503 });
        }
        this.recentlyHandled.set(key, true);
        if (this.recentlyHandled.size > MAX_RECENT_EVENTS) {
          const oldestKey = this.recentlyHandled.keys().next().value;
          if (oldestKey) this.recentlyHandled.delete(oldestKey);
        }
      }
      return new Response('OK', { status: 200 });
    } finally {
      release();
    }
  }
}
