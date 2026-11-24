import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import crypto from 'node:crypto';
import { handleGitHubWebhook } from '../src/server/github-webhook';

const SECRET = 'test-webhook-secret';
const sign = (body: string) =>
  'sha256=' + crypto.createHmac('sha256', SECRET).update(Buffer.from(body, 'utf-8')).digest('hex');

function makeApp() {
  const app = new Hono();
  app.post('/webhook', (c) => handleGitHubWebhook(c, { webhookSecret: SECRET }));
  return app;
}

describe('WA-022 webhook request-body boundaries', () => {
  it('accepts a properly signed payload (regression guard)', async () => {
    const body = JSON.stringify({ action: 'opened' });
    const res = await makeApp().request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(body),
        'x-github-event': 'pull_request'
      },
      body
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('rejects a declared-oversized request before reading the body', async () => {
    // A body stream that never yields: if the handler reads it, this test times out.
    const hangingBody = new ReadableStream<Uint8Array>({ start() {} });
    const res = await makeApp().request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'content-length': String(10 * 1024 * 1024),
        'x-hub-signature-256': sign('{}'),
        'x-github-event': 'ping'
      },
      // @ts-expect-error duplex needed for streaming bodies
      duplex: 'half',
      body: hangingBody
    });
    expect(res.status).toBe(413);
  }, 5_000);

  it('rejects a chunked body that grows past the cap during streaming', async () => {
    const encoder = new TextEncoder();
    let pushes = 0;
    const growing = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pushes++ < 4) controller.enqueue(encoder.encode('x'.repeat(512 * 1024)));
        else controller.close();
      }
    });
    const res = await makeApp().request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': sign('{}'),
        'x-github-event': 'ping'
      },
      // @ts-expect-error duplex needed for streaming bodies
      duplex: 'half',
      body: growing
    });
    expect(res.status).toBe(413);
  });

  it('rejects a tampered signature with no handler side effects', async () => {
    const body = JSON.stringify({ action: 'opened' });
    const res = await makeApp().request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': sign(body).replace(/.$/, '0'),
        'x-github-event': 'pull_request'
      },
      body
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed signature format', async () => {
    const res = await makeApp().request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'not-a-signature', 'x-github-event': 'ping' },
      body: '{}'
    });
    expect(res.status).toBe(401);
  });

  it('rejects malformed JSON with a valid signature as 400', async () => {
    const body = '{not json';
    const res = await makeApp().request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': sign(body), 'x-github-event': 'pull_request' },
      body
    });
    expect(res.status).toBe(400);
  });

  it('a signed ping still pongs within bounds', async () => {
    const body = '{}';
    const res = await makeApp().request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': sign(body), 'x-github-event': 'ping' },
      body
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('pong');
  });
});
