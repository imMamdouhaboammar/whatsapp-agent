import type { Hono } from 'hono';
import type { BroadcastOrchestrator, CreateBroadcastInput } from '../agent/broadcast-orchestrator';
import type { BroadcastStore } from '../domain/broadcast-store';
import type { BroadcastAudienceFilter } from '../domain/broadcast-types';

export function registerBroadcastRoutes(
  app: Hono,
  deps: { store: BroadcastStore; orchestrator: BroadcastOrchestrator }
): void {
  app.get('/api/broadcasts', (c) => {
    const limit = Number(c.req.query('limit') || '50');
    const campaigns = deps.store.listCampaigns(Number.isFinite(limit) ? limit : 50);
    return c.json({ campaigns });
  });

  app.post('/api/broadcasts/audience', async (c) => {
    const body = await c.req.json<{ filter?: BroadcastAudienceFilter; audiencePrompt?: string }>().catch((): { filter?: BroadcastAudienceFilter; audiencePrompt?: string } => ({}));
    const result = await deps.orchestrator.previewAudience(body.filter ?? {}, body.audiencePrompt);
    return c.json(result);
  });

  app.get('/api/broadcasts/audience', async (c) => {
    const query = c.req.query('query');
    const limit = Number(c.req.query('limit') || '100');
    const result = await deps.orchestrator.previewAudience(
      { ...(query ? { query } : {}), limit: Number.isFinite(limit) ? limit : 100 },
      query
    );
    return c.json(result);
  });

  app.post('/api/broadcasts', async (c) => {
    const body = await c.req.json<CreateBroadcastInput>().catch(() => null);
    if (!body || typeof body.name !== 'string' || !body.richContent || typeof body.richContent.messageGoal !== 'string') {
      return c.json({ error: 'Invalid broadcast payload: name and richContent.messageGoal are required' }, 400);
    }
    const created = await deps.orchestrator.createCampaign(body);
    return c.json(created, 201);
  });

  app.get('/api/broadcasts/:id', (c) => {
    const id = c.req.param('id');
    const campaign = deps.store.getCampaign(id);
    if (!campaign) return c.json({ error: 'Broadcast campaign not found' }, 404);
    const recipients = deps.store.listRecipients(id);
    const stats = deps.store.getCampaignStats(id);
    return c.json({ campaign: { ...campaign, stats }, recipients });
  });

  app.patch('/api/broadcasts/:id/recipients/:recipientId', async (c) => {
    const recipientId = c.req.param('recipientId');
    const body = await c.req.json<{ personalizedText?: string; status?: 'draft' | 'approved' | 'skipped' }>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
    const updated = deps.store.updateRecipientDraft(recipientId, body);
    if (!updated) return c.json({ error: 'Recipient not found' }, 404);
    return c.json({ recipient: updated });
  });

  app.post('/api/broadcasts/:id/approve', (c) => {
    const updated = deps.orchestrator.approveCampaign(c.req.param('id'));
    if (!updated) return c.json({ error: 'Broadcast campaign not found' }, 404);
    return c.json({ campaign: updated });
  });

  app.post('/api/broadcasts/:id/pause', (c) => {
    const updated = deps.orchestrator.pauseCampaign(c.req.param('id'));
    if (!updated) return c.json({ error: 'Broadcast campaign not found' }, 404);
    return c.json({ campaign: updated });
  });

  app.post('/api/broadcasts/:id/cancel', (c) => {
    const updated = deps.orchestrator.cancelCampaign(c.req.param('id'));
    if (!updated) return c.json({ error: 'Broadcast campaign not found' }, 404);
    return c.json({ campaign: updated });
  });

  app.post('/api/broadcasts/follow-ups/tick', async (c) => {
    const processed = await deps.orchestrator.tickFollowUps();
    return c.json({ processed });
  });
}
