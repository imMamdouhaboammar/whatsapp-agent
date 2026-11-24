import crypto from 'node:crypto';
import type { Context } from 'hono';
import { MEDIA_LIMITS, MediaTooLargeError, readRequestBodyTextWithCap } from '../agent/media-bounds';

export interface GitHubWebhookConfig {
  webhookSecret?: string;
  botUsername?: string;
}

/**
 * Verify GitHub Webhook HMAC-SHA256 signature in constant time.
 * Invariant 1: Constant-time verification using crypto.timingSafeEqual.
 */
export function verifyGitHubWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256' || !/^[0-9a-f]{64}$/i.test(parts[1])) {
    return false;
  }

  const expectedSignatureHex = parts[1];
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf-8') : rawBody);
  const calculatedDigest = hmac.digest('hex');

  const expectedBuffer = Buffer.from(expectedSignatureHex, 'hex');
  const calculatedBuffer = Buffer.from(calculatedDigest, 'hex');

  if (expectedBuffer.length !== calculatedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, calculatedBuffer);
}

/**
 * Handle incoming GitHub Webhook events for OpenReview.
 *
 * WA-022: the untrusted body is bounded BEFORE signature verification and parsing:
 * an oversized declared length is rejected without reading, and chunked uploads are
 * capped during streaming. HMAC is verified over the exact raw bytes as before.
 */
export async function handleGitHubWebhook(c: Context, config?: GitHubWebhookConfig) {
  const secret = config?.webhookSecret ?? process.env.GITHUB_APP_WEBHOOK_SECRET;
  const signatureHeader = c.req.header('X-Hub-Signature-256');
  const event = c.req.header('X-GitHub-Event');

  if (!secret) {
    return c.json({ error: 'GITHUB_APP_WEBHOOK_SECRET is not configured' }, 500);
  }

  const cap = MEDIA_LIMITS.maxWebhookBodyBytes;
  const declaredLength = Number(c.req.header('content-length') ?? 0);
  if (declaredLength > cap) {
    return c.json({ error: 'Webhook payload too large' }, 413);
  }

  let rawBody: string;
  try {
    rawBody = await readRequestBodyTextWithCap(c.req.raw, cap);
  } catch (err) {
    if (err instanceof MediaTooLargeError) {
      return c.json({ error: 'Webhook payload too large' }, 413);
    }
    throw err;
  }

  const isValid = verifyGitHubWebhookSignature(rawBody, signatureHeader, secret);
  if (!isValid) {
    return c.json({ error: 'Invalid HMAC signature' }, 401);
  }

  if (event === 'ping') {
    return c.json({ ok: true, message: 'OpenReview webhook pong' });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Malformed JSON payload' }, 400);
  }

  return c.json({
    ok: true,
    event,
    action: payload.action ?? null,
    receivedAt: new Date().toISOString()
  });
}
