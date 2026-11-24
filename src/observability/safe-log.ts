import { createHmac, randomBytes } from 'node:crypto';

// Salt keeps hashed chat IDs from being reversed by enumerating phone numbers.
// Set LOG_HASH_SALT to correlate IDs across restarts; otherwise it is random per process.
const processSalt = randomBytes(16).toString('hex');

// A short or guessable configured salt would let someone enumerate phone numbers against logged hashes,
// so values under 16 characters are ignored in favor of the random per-process salt. Use a random secret.
const MIN_SALT_LENGTH = 16;
function configuredSalt(): string {
  const value = process.env.LOG_HASH_SALT ?? '';
  return value.length >= MIN_SALT_LENGTH ? value : processSalt;
}

export function hashChatId(chatId: string, salt: string = configuredSalt()): string {
  return createHmac('sha256', salt).update(chatId).digest('hex').slice(0, 12);
}

export type SafeLogValue = string | number | boolean | null | undefined;

/** Lower-case keys that must never appear in a log line. */
const FORBIDDEN_KEYS = new Set([
  'text', 'body', 'message', 'messagetext', 'content', 'fusedtext', 'rawtext', 'payload', 'quoted', 'quotedmessage',
  'sender', 'sendername', 'name', 'chatid', 'jid', 'phone', 'phonenumber', 'caption', 'transcription'
]);
/** Keys the logger owns; callers cannot override severity or event identity. */
const RESERVED_KEYS = new Set(['level', 'event']);

/** `chat_id`, `Chat-Id` and `chatId` are the same key. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Writes one structured, metadata-only log line. Message content, sender identity and raw
 * chat IDs are rejected by key name so they cannot be added by accident. Use `chat` with
 * hashChatId() to correlate events.
 */
export function logEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, SafeLogValue> = {},
  sink: (line: string) => void = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error
): void {
  const safe: Record<string, SafeLogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    const normalized = normalizeKey(key);
    if (FORBIDDEN_KEYS.has(normalized) || RESERVED_KEYS.has(normalized)) continue;
    safe[key] = value;
  }
  sink(JSON.stringify({ ...safe, level, event }));
}

/** Metadata for a fused burst. Never includes text, sender name or the raw chat ID. */
export function describeBurst(msg: { chatId: string; text: string; type?: string }, messageCount?: number): Record<string, SafeLogValue> {
  return { chat: hashChatId(msg.chatId), chars: msg.text.length, type: msg.type ?? 'text', messages: messageCount };
}

/**
 * WA-025: strips credential-bearing URL userinfo, query strings, bearer/token assignments
 * and long digit runs (phone numbers, account ids) from arbitrary text so a provider error
 * message can never carry secrets or PII into logs or owner-facing strings. Keeps the
 * shape of the diagnostic (paths, codes) so errors stay actionable.
 */
export function redactSensitiveText(text: string): string {
  return text
    // credential userinfo in URLs: scheme://user:pass@host -> scheme://[redacted]@host
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/g, '$1[redacted]@')
    // query strings can carry tokens
    .replace(/\?[^\s"']*/g, '?[redacted]')
    // token/password/secret/key assignments
    .replace(/\b(token|password|passwd|secret|api[_-]?key|authorization|credential)(=|:)\S+/gi, '$1=[redacted]')
    // long digit runs: phone numbers, account ids
    .replace(/\b\d{6,}\b/g, '[digits]');
}

/** Error summary without the message, which can echo user content from providers. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  // Names and codes are only logged when they look like identifiers, so content cannot ride in them.
  const safeName = /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(err.name) ? err.name : 'Error';
  const code = (err as { code?: unknown }).code;
  const safeCode = typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code
    : typeof code === 'number' && Number.isFinite(code) ? String(code) : '';
  return safeCode ? `${safeName}:${safeCode}` : safeName;
}

/**
 * WA-025: safe single-line error detail for logs: identifier-shaped name/code via
 * describeError, plus a redacted message when it adds signal. Never contains raw
 * credentials, URLs with userinfo or phone-like digit runs.
 */
export function describeErrorDetail(err: unknown): string {
  // The raw message is never included: provider prose can echo arbitrary secrets or user
  // content that redaction cannot reliably recognize. Identifier-shaped name, code and
  // numeric status keep the log actionable without the risk.
  if (!(err instanceof Error)) return describeError(err);
  const base = describeError(err);
  const status = (err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  const safeStatus = typeof status === 'number' && Number.isFinite(status) ? `:${status}` : '';
  return `${base}${safeStatus}`;
}
