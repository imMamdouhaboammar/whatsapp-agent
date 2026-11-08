import { describe, expect, test } from 'bun:test';
import { FollowUpStore } from '../src/agent/follow-ups';
import { ProactiveEngagementScheduler, type ProactiveTemplateIntentCommand } from '../src/agent/proactive-scheduler';

const due = Date.UTC(2026, 10, 8, 12, 0);
const trigger = (sourceWorkflowId: string, dueAt = due, brandId = 'brand-a', contactId = 'contact-a') => ({
  brandId,
  contactId,
  reason: 'delivery_delay',
  dueAt,
  sourceWorkflowId,
  consentRef: 'consent-verified',
  templateRef: 'approved_delivery'
});

const eligible = {
  now: due,
  channel: 'meta-cloud' as const,
  optIn: true,
  templateApproved: true,
  optedInAtMs: due - 86_400_000,
  template: { name: 'approved_delivery', languageCode: 'en_US', components: [] },
  timeZone: 'UTC',
  quietHours: { from: 22, to: 9 },
  contactJid: '201234567890@s.whatsapp.net',
  relevance: {
    relevant: true,
    sourceWorkflowId: 'shipment-flow',
    verifiedAtMs: due - 1_000,
    expiresAtMs: due + 60_000
  }
};
const contextFor = (sourceWorkflowId: string, now = due) => ({
  ...eligible,
  relevance: { ...eligible.relevance, sourceWorkflowId, verifiedAtMs: now - 1_000, expiresAtMs: now + 60_000 }
});

describe('A08 durable scheduling store contract', () => {
  test('enumerates due triggers in stable due-time order with a hard bounded limit', () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const first = store.schedule(trigger('first', due - 2_000));
      const second = store.schedule(trigger('second', due - 1_000));
      store.schedule(trigger('future', due + 1_000));
      const rows = store.listDue(due, 2);
      expect(rows.map((item) => item.triggerId)).toEqual([first, second]);
      expect(store.listDue(due, 1)).toHaveLength(1);
      expect(store.listDue(due - 3_000)).toEqual([]);
    } finally { store.close(); }
  });

  test('an opt-out prevents scheduling subsequent nudges for that brand-contact pair', () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      store.optOut('brand-a', 'contact-a');
      expect(() => store.schedule(trigger('blocked'))).toThrow(/opted.out/i);
      expect(() => store.schedule(trigger('other-contact', due, 'brand-a', 'contact-b'))).not.toThrow();
      expect(() => store.schedule(trigger('other-brand', due, 'brand-b', 'contact-a'))).not.toThrow();
    } finally { store.close(); }
  });

  test('provider acceptance can reconcile an uncertain attempt without sending again', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const id = store.schedule(trigger('reconcile'));
      let sendCount = 0;
      const outcome = await store.dispatch(id, eligible, async () => {
        sendCount++;
        throw new Error('Unknown provider acceptance');
      });
      expect(outcome.status).toBe('uncertain');
      expect(store.listUnresolved(10).map((item) => item.triggerId)).toContain(id);
      expect(store.reconcileAccepted(id, 'wamid-verified')).toBe(true);
      expect(store.get(id)).toMatchObject({ status: 'sent', receiptId: 'wamid-verified' });
      expect(store.reconcileAccepted(id, 'second-id')).toBe(false);
      expect(sendCount).toBe(1);
    } finally { store.close(); }
  });
});

describe('A08 automatic proactive scheduler', () => {
  test('submits one authorized S01 template intent with stable source identity', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const id = store.schedule(trigger('shipment-flow'));
      const writes: ProactiveTemplateIntentCommand[] = [];
      const scheduler = new ProactiveEngagementScheduler({
        store,
        eligibility: async (item, now) => contextFor(item.sourceWorkflowId, now),
        sender: {
          submit: async (command) => {
            writes.push(command);
            return { state: 'accepted', intentId: 'intent-confirmed', providerMessageId: 'wamid-confirmed' };
          },
          lookup: async () => undefined
        }
      });
      expect(await scheduler.runOnce(due)).toEqual([{ triggerId: id, status: 'sent' }]);
      expect(store.get(id)).toMatchObject({ status: 'sent', receiptId: 'wamid-confirmed' });
      expect(writes).toEqual([{
        sourceKind: 'autopilot',
        sourceId: `a08:${id}`,
        sourceRevision: 1,
        actionKind: 'template',
        brandId: 'brand-a',
        contactId: 'contact-a',
        contactJid: '201234567890@s.whatsapp.net',
        reason: 'delivery_delay',
        optedInAtMs: due - 86_400_000,
        template: { name: 'approved_delivery', languageCode: 'en_US', components: [] },
        expiresAtMs: due + 60_000,
        relevanceVerifiedAtMs: due - 1_000,
        quietHours: { from: 22, to: 9, timeZone: 'UTC' },
        triggerId: id,
        sourceWorkflowId: 'shipment-flow',
        consentRef: 'consent-verified',
        templateRef: 'approved_delivery',
        idempotencyKey: `a08:${id}`
      }]);
      expect(await scheduler.runOnce(due + 1000)).toEqual([]);
      expect(writes).toHaveLength(1);
    } finally { store.close(); }
  });

  test('denies Baileys, missing opt-in and unapproved templates, deferring quiet hours', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const wrongChannel = store.schedule(trigger('baileys', due, 'baileys-brand', 'a'));
      const noConsent = store.schedule(trigger('consent', due, 'missing-consent', 'b'));
      const unapproved = store.schedule(trigger('template', due, 'unapproved', 'c'));
      const quiet = store.schedule(trigger('quiet', due, 'quiet-brand', 'd'));
      let sends = 0;
      const scheduler = new ProactiveEngagementScheduler({
        store,
        eligibility: async (item, now) => {
          if (item.brandId === 'baileys-brand') return { ...contextFor(item.sourceWorkflowId, now), channel: 'baileys' as const };
          if (item.brandId === 'missing-consent') return { ...contextFor(item.sourceWorkflowId, now), optIn: false };
          if (item.brandId === 'unapproved') return { ...contextFor(item.sourceWorkflowId, now), templateApproved: false };
          return { ...contextFor(item.sourceWorkflowId, now), quietHours: { from: 0, to: 24 } };
        },
        sender: {
          submit: async () => { sends++; return { state: 'accepted', intentId: 'unexpected', providerMessageId: 'unexpected' }; },
          lookup: async () => undefined
        }
      });
      const results = await scheduler.runOnce(due);
      expect(results).toEqual(expect.arrayContaining([
        { triggerId: wrongChannel, status: 'skipped', reason: 'unsupported_channel' },
        { triggerId: noConsent, status: 'skipped', reason: 'missing_consent' },
        { triggerId: unapproved, status: 'skipped', reason: 'no_approved_template' },
        { triggerId: quiet, status: 'deferred', reason: 'quiet_hours' }
      ]));
      expect(sends).toBe(0);
    } finally { store.close(); }
  });

  test('concurrent due scans atomically claim once across scheduler instances', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const id = store.schedule(trigger('one-send'));
      let entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let count = 0;
      const sender = {
        submit: async () => {
          count++;
          entered();
          await gate;
          return { state: 'accepted' as const, intentId: 'intent-once', providerMessageId: 'wamid-once' };
        },
        lookup: async () => undefined
      };
      const first = new ProactiveEngagementScheduler({ store, sender, eligibility: async (item, now) => contextFor(item.sourceWorkflowId, now) });
      const second = new ProactiveEngagementScheduler({ store, sender, eligibility: async (item, now) => contextFor(item.sourceWorkflowId, now) });
      const running = first.runOnce(due);
      await started;
      const competing = second.runOnce(due);
      release();
      await Promise.all([running, competing]);
      expect(count).toBe(1);
      expect(store.get(id)?.status).toBe('sent');
    } finally { store.close(); }
  });

  test('a queued/uncertain S01 result is reconciled after restart without another submit', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const id = store.schedule(trigger('recover'));
      let writes = 0;
      let accepted = false;
      const sender = {
        submit: async () => {
          writes++;
          return { state: 'queued' as const, intentId: 'pending-intent' };
        },
        lookup: async () => accepted
          ? { state: 'accepted' as const, intentId: 'pending-intent', providerMessageId: 'wamid-after-reconnect' }
          : { state: 'queued' as const, intentId: 'pending-intent' }
      };
      const before = new ProactiveEngagementScheduler({ store, sender, eligibility: async (item, now) => contextFor(item.sourceWorkflowId, now) });
      expect(await before.runOnce(due)).toEqual([{ triggerId: id, status: 'uncertain', reason: 'provider_outcome_unknown' }]);
      const restarted = new ProactiveEngagementScheduler({ store, sender, eligibility: async (item, now) => contextFor(item.sourceWorkflowId, now) });
      expect(await restarted.runOnce(due + 1_000)).toEqual([{ triggerId: id, status: 'waiting_provider' }]);
      expect(writes).toBe(1);
      accepted = true;
      expect(await restarted.runOnce(due + 2_000)).toEqual([{ triggerId: id, status: 'reconciled' }]);
      expect(store.get(id)).toMatchObject({ status: 'sent', receiptId: 'wamid-after-reconnect' });
      expect(writes).toBe(1);
    } finally { store.close(); }
  });

  test('an inbound reply cancels pending triggers; an explicit opt-out blocks future schedules', () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const replied = store.schedule(trigger('reply'));
      const optedOut = store.schedule(trigger('optout', due, 'brand-a', 'contact-b'));
      const scheduler = new ProactiveEngagementScheduler({
        store, eligibility: async (item, now) => contextFor(item.sourceWorkflowId, now),
        sender: {
          submit: async () => ({ state: 'accepted', intentId: 'unused', providerMessageId: 'unused' }),
          lookup: async () => undefined
        }
      });
      scheduler.onCustomerMessage({ brandId: 'brand-a', contactId: 'contact-a', text: 'I replied to the quote' });
      expect(store.get(replied)?.status).toBe('cancelled');
      scheduler.onCustomerMessage({ brandId: 'brand-a', contactId: 'contact-b', text: 'STOP' });
      expect(store.get(optedOut)?.status).toBe('cancelled');
      expect(() => store.schedule(trigger('future', due, 'brand-a', 'contact-b'))).toThrow(/opted.out/i);
      expect(() => store.schedule(trigger('another-brand', due, 'brand-b', 'contact-b'))).not.toThrow();
    } finally { store.close(); }
  });

  test('eligibility lookup failure postpones the trigger without outbound communication', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const id = store.schedule(trigger('offline-policy'));
      let sends = 0;
      const scheduler = new ProactiveEngagementScheduler({
        store,
        eligibility: async () => { throw new Error('private provider metadata'); },
        sender: {
          submit: async () => { sends++; return { state: 'accepted', intentId: 'unused', providerMessageId: 'unused' }; },
          lookup: async () => undefined
        }
      });
      expect(await scheduler.runOnce(due)).toEqual([{ triggerId: id, status: 'deferred', reason: 'eligibility_unavailable' }]);
      expect(store.get(id)?.status).toBe('scheduled');
      expect(sends).toBe(0);
    } finally { store.close(); }
  });
});

describe('A08 relevance and address enforcement', () => {
  test('does not submit an outreach intent when current business evidence is missing, stale or unrelated', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const cases = [
        { name: 'missing', source: 'missing', evaluation: { ...contextFor('missing'), relevance: undefined }, reason: 'missing_relevance_evidence' },
        { name: 'unrelated', source: 'unrelated', evaluation: contextFor('different-workflow'), reason: 'source_mismatch' },
        { name: 'irrelevant', source: 'irrelevant', evaluation: { ...contextFor('irrelevant'), relevance: { ...contextFor('irrelevant').relevance, relevant: false } }, reason: 'no_longer_relevant' },
        { name: 'expired', source: 'expired', evaluation: { ...contextFor('expired'), relevance: { ...contextFor('expired').relevance, expiresAtMs: due - 1 } }, reason: 'expired_relevance' },
        { name: 'future-proof', source: 'future-proof', evaluation: { ...contextFor('future-proof'), relevance: { ...contextFor('future-proof').relevance, verifiedAtMs: due + 1 } }, reason: 'invalid_relevance_evidence' },
        { name: 'unresolved-contact', source: 'unresolved-contact', evaluation: { ...contextFor('unresolved-contact'), contactJid: '' }, reason: 'unresolved_contact' }
      ];
      const byId = new Map(cases.map((c) => [store.schedule(trigger(c.source, due, c.source, 'contact')), c]));
      let submitted = 0;
      const scheduler = new ProactiveEngagementScheduler({
        store,
        eligibility: async (item) => byId.get(item.triggerId)!.evaluation as any,
        sender: {
          submit: async () => { submitted++; return { intentId: 'forbidden', state: 'accepted', providerMessageId: 'forbidden' }; },
          lookup: async () => undefined
        }
      });
      const result = await scheduler.runOnce(due);
      for (const [id, c] of byId) {
        expect(result).toContainEqual({ triggerId: id, status: 'skipped', reason: c.reason });
        expect(store.get(id)?.status).not.toBe('sent');
      }
      expect(submitted).toBe(0);
    } finally { store.close(); }
  });

  test('malformed quiet-hour boundaries fail closed and never queue a template', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const id = store.schedule(trigger('bad-quiet-hours'));
      let submitted = 0;
      const scheduler = new ProactiveEngagementScheduler({
        store,
        eligibility: async () => ({ ...contextFor('bad-quiet-hours'), quietHours: { from: 25, to: -1 } }),
        sender: {
          submit: async () => { submitted++; return { intentId: 'forbidden', state: 'accepted', providerMessageId: 'forbidden' }; },
          lookup: async () => undefined
        }
      });
      expect(await scheduler.runOnce(due)).toEqual([{ triggerId: id, status: 'deferred', reason: 'eligibility_unavailable' }]);
      expect(submitted).toBe(0);
    } finally { store.close(); }
  });
});

describe('A08 due-scan fairness and durable decisions', () => {
  test('cancels permanent denials with an audit reason, allowing later eligible work to progress', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const invalid = Array.from({ length: 101 }, (_, i) => store.schedule(trigger(`no-consent-${i}`, due - 1000, 'no-consent', `contact-${i}`)));
      const valid = store.schedule(trigger('deliver-good', due, 'good-brand', 'good-contact'));
      let accepted = 0;
      const scheduler = new ProactiveEngagementScheduler({
        store,
        eligibility: async (item, now) => ({ ...contextFor(item.sourceWorkflowId, now), optIn: item.brandId !== 'no-consent' }),
        sender: {
          submit: async () => { accepted++; return { intentId: 'valid', state: 'accepted', providerMessageId: 'wamid-valid' }; },
          lookup: async () => undefined
        }
      });
      const first = await scheduler.runOnce(due, 100);
      expect(first).toHaveLength(100);
      expect(first.every((entry) => entry.status === 'skipped')).toBe(true);
      expect(store.get(invalid[0]!)?.status).toBe('cancelled');
      expect(store.get(invalid[0]!)?.decisionReason).toBe('missing_consent');
      const second = await scheduler.runOnce(due, 100);
      expect(second).toContainEqual({ triggerId: valid, status: 'sent' });
      expect(accepted).toBe(1);
    } finally { store.close(); }
  });

  test('moves deferred quiet-hour work forward to avoid starving a due eligible contact', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const deferred = Array.from({ length: 100 }, (_, i) => store.schedule(trigger(`quiet-${i}`, due - 1000, 'quiet-brand', `contact-${i}`)));
      const valid = store.schedule(trigger('allowed', due, 'allowed-brand', 'allowed-contact'));
      let accepted = 0;
      const scheduler = new ProactiveEngagementScheduler({
        store,
        eligibility: async (item, now) => ({
          ...contextFor(item.sourceWorkflowId, now),
          quietHours: item.brandId === 'quiet-brand' ? { from: 0, to: 24 } : eligible.quietHours
        }),
        sender: {
          submit: async () => { accepted++; return { intentId: 'valid', state: 'accepted', providerMessageId: 'wamid-valid' }; },
          lookup: async () => undefined
        }
      });
      expect((await scheduler.runOnce(due, 100)).every((entry) => entry.status === 'deferred')).toBe(true);
      expect(store.get(deferred[0]!)?.dueAt).toBeGreaterThan(due);
      expect(await scheduler.runOnce(due, 100)).toContainEqual({ triggerId: valid, status: 'sent' });
      expect(accepted).toBe(1);
    } finally { store.close(); }
  });
});

describe('A08 runner and inbound observability', () => {
  test('runs automatically on a polling interval until aborted, without needing a manual tick', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    const stop = new AbortController();
    try {
      const id = store.schedule(trigger('auto-run'));
      let accepted = 0;
      const scheduler = new ProactiveEngagementScheduler({
        store,
        eligibility: async (item, now) => contextFor(item.sourceWorkflowId, now),
        sender: {
          submit: async () => {
            accepted++;
            stop.abort();
            return { intentId: 'auto', state: 'accepted', providerMessageId: 'wamid-auto' };
          },
          lookup: async () => undefined
        }
      });
      await scheduler.start({ intervalMs: 5, signal: stop.signal, now: () => due });
      expect(store.get(id)).toMatchObject({ status: 'sent', receiptId: 'wamid-auto' });
      expect(accepted).toBe(1);
    } finally { stop.abort(); store.close(); }
  });

  test('emits replied for every cancelled pending trigger while suppressing later attempts', async () => {
    const store = new FollowUpStore({ dbPath: ':memory:' });
    try {
      const ids = [store.schedule(trigger('open-quote')), store.schedule(trigger('lead-reminder'))];
      const observed: Array<{ type: string; triggerId: string }> = [];
      const scheduler = new ProactiveEngagementScheduler({
        store,
        eligibility: async (item, now) => contextFor(item.sourceWorkflowId, now),
        sender: {
          submit: async () => ({ intentId: 'unexpected', state: 'accepted', providerMessageId: 'unexpected' }),
          lookup: async () => undefined
        },
        onEvent: (event) => { observed.push(event); }
      });
      scheduler.onCustomerMessage({ brandId: 'brand-a', contactId: 'contact-a', text: 'Hello, I saw your message' });
      expect(observed.filter((event) => event.type === 'engagement.replied').map((event) => event.triggerId).sort()).toEqual(ids.sort());
      expect(await scheduler.runOnce(due)).toEqual([]);
      expect(store.get(ids[0]!)?.decisionReason).toBe('customer_replied');
    } finally { store.close(); }
  });
});

test('A08 requires real consent timing and approved template identity before durable submission', async () => {
  const store = new FollowUpStore({ dbPath: ':memory:' });
  try {
    const cases = [
      { source: 'future-consent', evaluation: { ...contextFor('future-consent'), optedInAtMs: due + 100 }, reason: 'invalid_consent_evidence' },
      { source: 'missing-template-payload', evaluation: { ...contextFor('missing-template-payload'), template: undefined }, reason: 'invalid_template_payload' },
      { source: 'template-mismatch', evaluation: { ...contextFor('template-mismatch'), template: { name: 'different_template', languageCode: 'en_US' } }, reason: 'template_mismatch' }
    ];
    const byId = new Map(cases.map((entry) => [store.schedule(trigger(entry.source)), entry]));
    let submitted = 0;
    const scheduler = new ProactiveEngagementScheduler({
      store,
      eligibility: async (item) => byId.get(item.triggerId)!.evaluation as any,
      sender: {
        submit: async () => { submitted++; return { intentId: 'forbidden', state: 'accepted', providerMessageId: 'forbidden' }; },
        lookup: async () => undefined
      }
    });
    const result = await scheduler.runOnce(due);
    for (const [id, entry] of byId) expect(result).toContainEqual({ triggerId: id, status: 'skipped', reason: entry.reason });
    expect(submitted).toBe(0);
  } finally { store.close(); }
});
