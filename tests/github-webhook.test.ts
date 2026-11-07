import { describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import { verifyGitHubWebhookSignature } from '../src/server/github-webhook';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';

describe('OpenReview GitHub Webhook & HMAC Verification', () => {
  const secret = 'test-openreview-hmac-secret-12345';
  const payload = JSON.stringify({ action: 'opened', pull_request: { number: 42, title: 'feat: add openreview' } });

  function signPayload(body: string, sec: string): string {
    const hmac = crypto.createHmac('sha256', sec);
    hmac.update(Buffer.from(body, 'utf-8'));
    return `sha256=${hmac.digest('hex')}`;
  }

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
    const mockMemoryStore = {
      getSqliteStore: () => ({}),
      getContactMemories: () => [],
      getChatStyle: () => 'casual',
      setChatStyle: () => {},
      deleteContactMemory: () => true
    } as unknown as Parameters<typeof createApiServer>[0]['memoryStore'];
    const mockWhatsappClient = {} as unknown as Parameters<typeof createApiServer>[0]['whatsappClient'];
    const mockModeratorAgent = {} as unknown as Parameters<typeof createApiServer>[0]['moderatorAgent'];
    const sse = new SSEBroadcaster();

    const app = createApiServer({
      memoryStore: mockMemoryStore,
      whatsappClient: mockWhatsappClient,
      moderatorAgent: mockModeratorAgent,
      sse
    });

    // 1. Missing secret / header -> 401
    const resUnauthorized = await app.request('/api/webhooks/github', {
      method: 'POST',
      body: payload
    });
    expect(resUnauthorized.status).toBe(500); // Because GITHUB_APP_WEBHOOK_SECRET is not set in env

    // Now test with secret in env
    const prevSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    try {
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
      process.env.GITHUB_APP_WEBHOOK_SECRET = prevSecret;
    }
  });
});
