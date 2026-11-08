import type { FollowUpEvaluation, FollowUpStore, FollowUpTrigger } from './follow-ups';

/**
 * S01 must persist the template intent before an official Meta Cloud network call.
 * The runtime bridge owns contact/JID resolution, provider credentials and template variables.
 */
export interface ProactiveIntentIdentity {
  sourceKind: 'autopilot';
  sourceId: string;
  sourceRevision: 1;
  brandId: string;
  contactId: string;
  triggerId: string;
  idempotencyKey: string;
}

export interface ProactiveTemplateComponent {
  type: 'header' | 'body';
  parameters: Array<{ type: 'text'; text: string }>;
}

export interface ProactiveTemplateIntentCommand extends ProactiveIntentIdentity {
  actionKind: 'template';
  sourceWorkflowId: string;
  reason: string;
  consentRef: string;
  optedInAtMs: number;
  templateRef: string;
  template: { name: string; languageCode: string; components?: ProactiveTemplateComponent[] };
  contactJid: string;
  expiresAtMs: number;
  relevanceVerifiedAtMs: number;
  quietHours: { from: number; to: number; timeZone: string };
}

/** A08 requires current business facts, not an old reminder trigger alone. */
export interface ProactiveEligibility extends FollowUpEvaluation {
  contactJid: string;
  optedInAtMs: number;
  template: { name: string; languageCode: string; components?: ProactiveTemplateComponent[] };
  relevance: {
    relevant: boolean;
    sourceWorkflowId: string;
    verifiedAtMs: number;
    expiresAtMs: number;
  };
}

export type ProactiveDeliveryState = 'queued' | 'attempting' | 'accepted' | 'delivered' | 'read' | 'uncertain' | 'failed';

export interface ProactiveIntentResult {
  intentId: string;
  state: ProactiveDeliveryState;
  providerMessageId?: string;
}

export interface ProactiveTemplateIntentSender {
  /** S01-backed write. Must use sourceId/revision for durable idempotency. */
  submit(command: ProactiveTemplateIntentCommand): Promise<ProactiveIntentResult>;
  /** Strictly read-only provider/ledger reconciliation; never resends. */
  lookup(identity: ProactiveIntentIdentity): Promise<ProactiveIntentResult | undefined>;
}

export interface ProactiveTickResult {
  triggerId: string;
  status: 'sent' | 'uncertain' | 'skipped' | 'deferred' | 'reconciled' | 'waiting_provider';
  reason?: string;
}

export class ProactiveEngagementScheduler {
  constructor(private readonly deps: {
    store: FollowUpStore;
    sender: ProactiveTemplateIntentSender;
    eligibility: (trigger: FollowUpTrigger, now: number) => Promise<ProactiveEligibility>;
    onEvent?: (event: { type: 'engagement.trigger.ready' | 'engagement.sent' | 'engagement.skipped' | 'engagement.replied'; triggerId: string }) => void;
  }) {}

  private identity(trigger: FollowUpTrigger): ProactiveIntentIdentity {
    const sourceId = `a08:${trigger.triggerId}`;
    return {
      sourceKind: 'autopilot',
      sourceId,
      sourceRevision: 1,
      brandId: trigger.brandId,
      contactId: trigger.contactId,
      triggerId: trigger.triggerId,
      idempotencyKey: sourceId
    };
  }

  private command(trigger: FollowUpTrigger, eligibility: ProactiveEligibility): ProactiveTemplateIntentCommand {
    return {
      ...this.identity(trigger),
      actionKind: 'template',
      sourceWorkflowId: trigger.sourceWorkflowId,
      reason: trigger.reason,
      consentRef: trigger.consentRef ?? '',
      optedInAtMs: eligibility.optedInAtMs,
      templateRef: trigger.templateRef ?? '',
      template: eligibility.template,
      contactJid: eligibility.contactJid,
      expiresAtMs: eligibility.relevance.expiresAtMs,
      relevanceVerifiedAtMs: eligibility.relevance.verifiedAtMs,
      quietHours: {
        from: eligibility.quietHours.from,
        to: eligibility.quietHours.to,
        timeZone: eligibility.timeZone
      }
    };
  }

  private relevanceDecision(trigger: FollowUpTrigger, eligibility: ProactiveEligibility, now: number): string | undefined {
    if (!eligibility.contactJid?.trim()) return 'unresolved_contact';
    if (!Number.isSafeInteger(eligibility.optedInAtMs) || eligibility.optedInAtMs < 1 ||
        eligibility.optedInAtMs > now) return 'invalid_consent_evidence';
    const template = eligibility.template;
    if (!template || typeof template.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(template.name) ||
        typeof template.languageCode !== 'string' || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(template.languageCode) ||
        (template.components !== undefined && (!Array.isArray(template.components) ||
          !template.components.every((part) => (part.type === 'header' || part.type === 'body') &&
            Array.isArray(part.parameters) && part.parameters.every((p) => p.type === 'text' && typeof p.text === 'string'))))) {
      return 'invalid_template_payload';
    }
    if (template.name !== trigger.templateRef) return 'template_mismatch';
    const evidence = eligibility.relevance;
    if (!evidence) return 'missing_relevance_evidence';
    if (evidence.sourceWorkflowId !== trigger.sourceWorkflowId) return 'source_mismatch';
    if (evidence.relevant !== true) return 'no_longer_relevant';
    if (!Number.isSafeInteger(evidence.verifiedAtMs) || !Number.isSafeInteger(evidence.expiresAtMs) ||
        evidence.verifiedAtMs > now || evidence.expiresAtMs < evidence.verifiedAtMs) {
      return 'invalid_relevance_evidence';
    }
    if (evidence.expiresAtMs < now) return 'expired_relevance';
    return undefined;
  }

  private emit(type: 'engagement.trigger.ready' | 'engagement.sent' | 'engagement.skipped' | 'engagement.replied', triggerId: string): void {
    try { this.deps.onEvent?.({ type, triggerId }); }
    catch { /* Diagnostics must never alter the durable send decision. */ }
  }

  async runOnce(now = Date.now(), limit = 25): Promise<ProactiveTickResult[]> {
    if (!Number.isFinite(now) || !Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Invalid proactive scheduler scan');
    }
    const bounded = Math.min(limit, 100);
    const results: ProactiveTickResult[] = [];

    // Reconciliation reads a durable S01 intent without initiating another send.
    for (const trigger of this.deps.store.listUnresolved(bounded)) {
      let observed: ProactiveIntentResult | undefined;
      try { observed = await this.deps.sender.lookup(this.identity(trigger)); }
      catch { /* Leave an ambiguous provider outcome untouched. */ }
      if (observed?.providerMessageId && ['accepted', 'delivered', 'read'].includes(observed.state)) {
        const changed = this.deps.store.reconcileAccepted(trigger.triggerId, observed.providerMessageId);
        if (changed) {
          this.emit('engagement.sent', trigger.triggerId);
          results.push({ triggerId: trigger.triggerId, status: 'reconciled' });
          continue;
        }
      }
      results.push({ triggerId: trigger.triggerId, status: 'waiting_provider' });
    }

    for (const trigger of this.deps.store.listDue(now, bounded)) {
      let context: ProactiveEligibility;
      try {
        const supplied = await this.deps.eligibility(trigger, now);
        // The scanner clock is authoritative; an integration cannot time-travel the policy check.
        context = { ...supplied, now };
        const decision = this.deps.store.evaluate(trigger.triggerId, context);
        if (decision.decision !== 'send') {
          const status = decision.decision === 'skip' ? 'skipped' : 'deferred';
          if (status === 'skipped') {
            if (this.deps.store.cancel(trigger.triggerId, decision.reason)) this.emit('engagement.skipped', trigger.triggerId);
          } else {
            this.deps.store.deferUntil(trigger.triggerId, now + 15 * 60_000, decision.reason);
          }
          results.push({ triggerId: trigger.triggerId, status, reason: decision.reason });
          continue;
        }
        const relevanceIssue = this.relevanceDecision(trigger, context, now);
        if (relevanceIssue) {
          if (this.deps.store.cancel(trigger.triggerId, relevanceIssue)) this.emit('engagement.skipped', trigger.triggerId);
          results.push({ triggerId: trigger.triggerId, status: 'skipped', reason: relevanceIssue });
          continue;
        }
      } catch {
        this.deps.store.deferUntil(trigger.triggerId, now + 15 * 60_000, 'eligibility_unavailable');
        results.push({ triggerId: trigger.triggerId, status: 'deferred', reason: 'eligibility_unavailable' });
        continue;
      }
      this.emit('engagement.trigger.ready', trigger.triggerId);
      const outcome = await this.deps.store.dispatch(trigger.triggerId, context, async (claimed) => {
        const result = await this.deps.sender.submit(this.command(claimed, context));
        if (!result.intentId || !result.providerMessageId ||
            !['accepted', 'delivered', 'read'].includes(result.state)) {
          throw new Error('S01 template intent requires receipt reconciliation');
        }
        return result.providerMessageId;
      });
      if (outcome.status === 'sent') this.emit('engagement.sent', trigger.triggerId);
      if (outcome.status === 'skipped' && this.deps.store.cancel(trigger.triggerId, outcome.reason ?? 'policy_denied')) this.emit('engagement.skipped', trigger.triggerId);
      if (outcome.status === 'deferred') this.deps.store.deferUntil(trigger.triggerId, now + 15 * 60_000, outcome.reason ?? 'deferred');
      results.push({ triggerId: trigger.triggerId, status: outcome.status, reason: outcome.reason });
    }
    return results;
  }

  /**
   * Runs immediately, then on a bounded interval until aborted. The runtime owner
   * supplies the AbortSignal and starts this only after the S01 template bridge is ready.
   */
  async start(input: {
    signal: AbortSignal;
    intervalMs?: number;
    now?: () => number;
    onError?: (error: unknown) => void;
  }): Promise<void> {
    const interval = input.intervalMs ?? 30_000;
    if (!Number.isSafeInteger(interval) || interval < 1 || interval > 3_600_000) {
      throw new Error('Invalid proactive poll interval');
    }
    const clock = input.now ?? Date.now;
    while (!input.signal.aborted) {
      try { await this.runOnce(clock()); }
      catch (error) {
        try { input.onError?.(error); }
        catch { /* Telemetry is advisory. */ }
      }
      if (input.signal.aborted) break;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          input.signal.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(finish, interval);
        input.signal.addEventListener('abort', finish, { once: true });
        if (input.signal.aborted) finish();
      });
    }
  }

  /** Called by the inbound owner coordinator after brand/contact reconciliation. */
  onCustomerMessage(input: { brandId: string; contactId: string; text: string }): void {
    const normalized = input.text.normalize('NFKC').trim().toLocaleLowerCase('en');
    const optsOut = new Set(['stop', 'unsubscribe', 'cancel updates', 'إلغاء الاشتراك', 'الغاء الاشتراك', 'وقف الرسائل', 'أوقف الرسائل', 'اوقف الرسائل']);
    const affected = optsOut.has(normalized)
      ? this.deps.store.optOut(input.brandId, input.contactId)
      : this.deps.store.onCustomerReply(input.brandId, input.contactId);
    for (const triggerId of affected) this.emit('engagement.replied', triggerId);
  }
}
