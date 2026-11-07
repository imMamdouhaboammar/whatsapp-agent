import crypto from 'node:crypto';
import type { Context } from 'hono';

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
  if (parts.length !== 2 || parts[0] !== 'sha256') {
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
 */
export async function handleGitHubWebhook(c: Context, config?: GitHubWebhookConfig) {
  const secret = config?.webhookSecret ?? process.env.GITHUB_APP_WEBHOOK_SECRET;
  const signatureHeader = c.req.header('X-Hub-Signature-256');
  const event = c.req.header('X-GitHub-Event');

  if (!secret) {
    return c.json({ error: 'GITHUB_APP_WEBHOOK_SECRET is not configured' }, 500);
  }

  const rawBody = await c.req.text();

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
