import { describe, expect, it } from 'bun:test';
import { createFableWhatsAppAgent } from '../src/index';
import type { ChatMessage } from '../src/domain/types';

describe('Engine Integration & Autonomous Loop', () => {
  it('initializes agent engine with SQLite WAL and responds to API requests', async () => {
    const agent = await createFableWhatsAppAgent({
      port: 3999,
      dataDir: ':memory:',
      autoConnect: false
    });

    expect(agent).toBeDefined();
    expect(agent.memoryStore).toBeDefined();
    expect(agent.whatsappClient).toBeDefined();
    expect(agent.moderatorAgent).toBeDefined();

    // Verify REST status endpoint
    const res = await agent.app.request('/api/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.state).toBe('disconnected');
    expect(body.pendingDraftsCount).toBe(0);

    agent.memoryStore.close();
  });

  it('manages contact dossier via REST API', async () => {
    const agent = await createFableWhatsAppAgent({
      port: 3998,
      dataDir: ':memory:',
      autoConnect: false
    });

    const chatId = '201012345678@s.whatsapp.net';

    // 1. Get empty dossier
    const getRes1 = await agent.app.request(`/api/contacts/${chatId}/dossier`);
    expect(getRes1.status).toBe(200);
    const body1 = (await getRes1.json()) as any;
    expect(body1.dossier.chatId).toBe(chatId);
    expect(body1.dossier.stage).toBe('lead');
    expect(body1.dossier.facts).toEqual([]);

    // 2. Add fact
    const factRes = await agent.app.request(`/api/contacts/${chatId}/dossier/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact: 'العميل مهتم بخطة النمو السنوية' })
    });
    expect(factRes.status).toBe(200);
    const factBody = (await factRes.json()) as any;
    expect(factBody.dossier.facts).toContain('العميل مهتم بخطة النمو السنوية');

    // 3. Add commitment
    const commRes = await agent.app.request(`/api/contacts/${chatId}/dossier/commitments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitment: 'إرسال العقد للتوقيع يوم الأحد' })
    });
    expect(commRes.status).toBe(200);
    const commBody = (await commRes.json()) as any;
    expect(commBody.dossier.commitments).toContain('إرسال العقد للتوقيع يوم الأحد');

    // 4. Update stage
    const updateRes = await agent.app.request(`/api/contacts/${chatId}/dossier`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'negotiation' })
    });
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as any;
    expect(updateBody.dossier.stage).toBe('negotiation');

    agent.memoryStore.close();
  });
});
