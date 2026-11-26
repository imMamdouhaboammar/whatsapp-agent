import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import { describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import { verifyGitHubWebhookSignature } from '../src/server/github-webhook';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';

function signPayload(body: string, sec: string): string {
  const hmac = crypto.createHmac('sha256', sec);
  hmac.update(Buffer.from(body, 'utf-8'));
  return `sha256=${hmac.digest('hex')}`;
}

describe('OpenReview GitHub Webhook & HMAC Verification', () => {
  const secret = 'test-openreview-hmac-secret-12345';
  const payload = JSON.stringify({ action: 'opened', pull_request: { number: 42, title: 'feat: add openreview' } });

  it('validates a correct HMAC-SHA256 signature', () => {
    const validSignature = signPayload(payload, secret);
    const result = verifyGitHubWebhookSignature(payload, validSignature, secret);
    expect(result).toBe(true);
  });

  it('rejects tampered payload content', () => {
    const validSignature = signPayload(payload, secret);
    const tamperedPayload = JSON.stringify({ action: 'opened', pull_request: { number: 999 } });
    const result = verifyGitHubWebhookSignature(tamperedPayload, validSignature, secret);
    expect(result).toBe(false);
  });

  it('rejects signatures generated with wrong secret', () => {
    const invalidSignature = signPayload(payload, 'wrong-secret');
    const result = verifyGitHubWebhookSignature(payload, invalidSignature, secret);
    expect(result).toBe(false);
  });

  it('rejects malformed signature headers', () => {
    expect(verifyGitHubWebhookSignature(payload, 'invalid-header', secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(payload, 'md5=abcdef', secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(payload, '', secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(payload, null, secret)).toBe(false);
  });

  it('serves POST /api/webhooks/github and responds to ping and signed events', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:' });
    const prevSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    try {
      delete process.env.GITHUB_APP_WEBHOOK_SECRET;
      const app = createApiServer({
        memoryStore,
        moderatorAgent: new ModeratorAgent(new GeminiClient({ apiKey: 'test-key' }), memoryStore),
        sse: new SSEBroadcaster()
      });

      // 1. Missing secret / header -> 401
      const resUnauthorized = await app.request('/api/webhooks/github', {
        method: 'POST',
        body: payload
      });
      expect(resUnauthorized.status).toBe(500);

      process.env.GITHUB_APP_WEBHOOK_SECRET = secret;

      // 2. Invalid signature -> 401
      const resBadSig = await app.request('/api/webhooks/github', {
        method: 'POST',
        headers: {
          'X-Hub-Signature-256': 'sha256=baddeadbeef',
          'Content-Type': 'application/json'
        },
        body: payload
      });
      expect(resBadSig.status).toBe(401);

      // 3. Valid ping event -> 200
      const pingBody = JSON.stringify({ zen: 'Mind over matter.' });
      const pingSig = signPayload(pingBody, secret);
      const resPing = await app.request('/api/webhooks/github', {
        method: 'POST',
        headers: {
          'X-Hub-Signature-256': pingSig,
          'X-GitHub-Event': 'ping',
          'Content-Type': 'application/json'
        },
        body: pingBody
      });
      expect(resPing.status).toBe(200);
      const pingJson = await resPing.json();
      expect(pingJson.ok).toBe(true);

      // 4. Valid pull_request event -> 200
      const prSig = signPayload(payload, secret);
      const resPR = await app.request('/api/webhooks/github', {
        method: 'POST',
        headers: {
          'X-Hub-Signature-256': prSig,
          'X-GitHub-Event': 'pull_request',
          'Content-Type': 'application/json'
        },
        body: payload
      });
      expect(resPR.status).toBe(200);
      const prJson = await resPR.json();
      expect(prJson.ok).toBe(true);
      expect(prJson.event).toBe('pull_request');
      expect(prJson.action).toBe('opened');
    } finally {
      if (prevSecret === undefined) delete process.env.GITHUB_APP_WEBHOOK_SECRET;
      else process.env.GITHUB_APP_WEBHOOK_SECRET = prevSecret;
      memoryStore.close();
    }
  });
});
