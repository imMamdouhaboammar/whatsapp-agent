import type { Hono } from 'hono';
import { isRecord } from '../domain/sqlite-values';
import type { BroadcastOrchestrator, CreateBroadcastInput } from '../agent/broadcast-orchestrator';
import { isAudienceFilter, isRichContent, type BroadcastStore } from '../domain/broadcast-store';
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
    const body = await c.req.json<{ filter?: BroadcastAudienceFilter; audiencePrompt?: string }>().catch(() => null);
    if (!body || !isRecord(body) || (body.filter !== undefined && !isAudienceFilter(body.filter)) || (body.audiencePrompt !== undefined && typeof body.audiencePrompt !== 'string')) return c.json({error:'Invalid audience filter'},400);
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
    if (!body || typeof body.name !== 'string' || !body.name.trim() || typeof body.goal !== 'string' || !body.goal.trim() || !isRichContent(body.richContent) || (body.audienceFilter !== undefined && !isAudienceFilter(body.audienceFilter)) || (body.audiencePrompt !== undefined && typeof body.audiencePrompt !== 'string') || (body.permissionConfirmed !== undefined && typeof body.permissionConfirmed !== 'boolean')) {
      return c.json({ error: 'Invalid broadcast payload: name and richContent.messageGoal are required' }, 400);
    }
    try {
      const created = await deps.orchestrator.createCampaign({...body,signal:c.req.raw.signal});
      return c.json(created, 201);
    } catch {
      return c.json({error:'Could not prepare campaign. Check audience and model configuration.'},422);
    }
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
    if (body.personalizedText !== undefined && typeof body.personalizedText !== 'string') return c.json({error:'Invalid message'},400);
    const recipient = deps.store.getRecipient(recipientId);
    if (!recipient || recipient.campaignId !== c.req.param('id')) return c.json({error:'Recipient not found'},404);
    const updated = deps.store.updateRecipientDraft(recipientId, body);
    if (!updated) return c.json({ error: 'Recipient not found' }, 404);
    return c.json({ recipient: updated });
  });

  app.post('/api/broadcasts/:id/recipients/:recipientId/regenerate', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || (body.name !== undefined && typeof body.name !== 'string')) return c.json({error:'Invalid name override'},400);
    try {
      const recipient = await deps.orchestrator.regenerateDraft(c.req.param('id'),c.req.param('recipientId'),body.name,c.req.raw.signal);
      return c.json({recipient});
    } catch {
      return c.json({error:'Could not regenerate this draft. Check eligibility, model and campaign state.'},409);
    }
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
