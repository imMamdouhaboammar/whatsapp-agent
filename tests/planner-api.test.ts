import { expect, test } from 'bun:test';
import { createFableWhatsAppAgent } from '../src/index';
import type { GeminiClient } from '../src/ai/gemini-client';
import { Hono } from 'hono';
import { createCapabilities, registerCapabilityRoutes } from '../src/agent/capabilities-api';

const auth = { 'content-type': 'application/json', 'x-agent-owner-token': 'owner-a05' };
const invoke = (agent: Awaited<ReturnType<typeof createFableWhatsAppAgent>>, body: unknown, headers: Record<string,string> = auth) =>
  agent.app.request('/api/agent/plan', { method: 'POST', headers, body: JSON.stringify(body) });

test('A05 authenticated owner executes a scoped read-and-ticket workflow with receipt, no WhatsApp connection', async () => {
  let step = 0;
  const model = { generateContent: async () => {
    step++;
    if (step === 1) return { functionCalls: [{ name: 'order_lookup', args: { orderId: '441' } }] };
    if (step === 2) return { functionCalls: [{ name: 'ticket_create', args: { orderId: '441' } }] };
    return { text: 'تم فتح التذكرة للطلب' };
  } };
  const agent = await createFableWhatsAppAgent({ dataDir: ':memory:', autoConnect: false, capabilityToken: 'owner-a05', capabilityModel: model as unknown as Pick<GeminiClient, 'generateContent'> });
  const calls: string[] = [];
  try {
    agent.capabilities.registry.register('brand-a', {
      name: 'order.lookup', kind: 'read', scope: 'orders:read',
      parameters: { type: 'OBJECT', properties: { orderId: { type: 'STRING' } }, required: ['orderId'] },
      validate: (v): v is {orderId:string} => typeof v === 'object' && v !== null && 'orderId' in v && typeof v.orderId === 'string',
      execute: async ({orderId}) => { calls.push('read:' + orderId); return { orderId, status: 'late' }; }
    });
    agent.capabilities.registry.register('brand-a', {
      name: 'ticket.create', kind: 'write', scope: 'tickets:write',
      parameters: { type: 'OBJECT', properties: { orderId: { type: 'STRING' } }, required: ['orderId'] },
      validate: (v): v is {orderId:string} => typeof v === 'object' && v !== null && 'orderId' in v && typeof v.orderId === 'string',
      execute: async ({orderId}) => { calls.push('write:' + orderId); return { orderId, providerReceiptId: 'T-441' }; }
    });
    const request = { brandId: 'brand-a', contactId: 'customer-a', goal: 'Find order 441, then open a ticket', allowedScopes: ['orders:read','tickets:write'], allowWrites: true };
    expect((await invoke(agent, request, { 'content-type': 'application/json' })).status).toBe(401);
    const complete = await invoke(agent, request);
    expect(complete.status).toBe(200);
    const body = await complete.json() as {status:string;reply:string;evidence:unknown[]};
    expect(body.status).toBe('completed');
    expect(body.reply).toContain('T-441');
    expect(body.evidence).toHaveLength(2);
    expect(calls).toEqual(['read:441','write:441']);
    expect((await invoke(agent, { ...request, contactId: 'customer-b', allowWrites: 'yes' })).status).toBe(400);
    expect((await invoke(agent, { ...request, contactId: '' })).status).toBe(400);
    expect((await invoke(agent, { ...request, contactId: 'bad' + String.fromCharCode(10) + 'contact' })).status).toBe(400);
    expect((await invoke(agent, { ...request, brandId: 'other', workflowId: 'cross-brand' })).status).toBe(200);
    expect(calls).toHaveLength(2);
  } finally { agent.capabilities.close(); agent.memoryStore.close(); }
});

test('A05 owner API requires provider model and rejects malformed owner scopes', async () => {
  const app = new Hono();
  const capabilities = createCapabilities(':memory:');
  registerCapabilityRoutes(app, capabilities, 'owner-a05');
  const invokeOffline = (body:unknown) => app.request('/api/agent/plan', { method: 'POST', headers: auth, body: JSON.stringify(body) });
  try {
    const body = { brandId: 'b', contactId: 'c', goal: 'Find order', allowedScopes: ['orders:read'] };
    expect((await invokeOffline(body)).status).toBe(503);
    expect((await invokeOffline({...body, allowedScopes: ['orders:read', {'$admin': true}]})).status).toBe(400);
    expect((await invokeOffline({...body, goal: 'x'.repeat(2001)})).status).toBe(400);
  } finally { capabilities.close(); }
});
