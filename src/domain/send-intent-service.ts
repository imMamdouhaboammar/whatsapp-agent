import { randomUUID } from 'node:crypto';
import type { MemoryStore } from './memory-store';
import type { ChatMessage } from './types';
import type { SendIntent, SendIntentInput } from './send-ledger';
import type { DiagnosticsCore, DiagnosticStage, DiagnosticOutcome, ReceiptState } from '../observability/diagnostics-core';

export interface SendResult {
  intent: SendIntent;
  message?: ChatMessage;
}

type SendText = (
  chatId: string,
  text: string,
  options?: { replyToMessageId?: string; simulatedDelayMs?: number }
) => Promise<{ messageId: string }>;

type SendVoice = (
  chatId: string,
  preparedAudio: Buffer | Uint8Array,
  options?: { replyToMessageId?: string }
) => Promise<{ messageId: string }>;

export class SendIntentService {
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly random: () => number;
  private readonly workerId = randomUUID();

  constructor(private readonly options: {
    memoryStore: MemoryStore;
    diagnostics?: DiagnosticsCore;
    sendText: SendText;
    prepareVoice?: (text: string) => Promise<Buffer | Uint8Array>;
    sendVoice?: SendVoice;
    maxAttempts?: number;
    retryBaseMs?: number;
    random?: () => number;
    publish?: (event: 'new_message' | 'send_intent', data: unknown) => void;
  }) {
    this.maxAttempts = Math.max(1, Math.min(10, options.maxAttempts ?? 3));
    this.retryBaseMs = Math.max(1, options.retryBaseMs ?? 1200);
    this.random = options.random ?? Math.random;
    options.memoryStore.getSendLedger().recoverInterrupted();
  }

  async sendText(input: SendIntentInput): Promise<SendResult> {
    if (input.actionKind !== 'text') throw new Error('Text delivery requires a text intent');
    this.requireAutopilotMode(input);
    const { intent, created } = this.options.memoryStore.getSendLedger().createIntentWithStatus(input);
    if (created) this.observeCreated(intent);
    return this.dispatch(intent.id);
  }

  async sendVoice(input: SendIntentInput): Promise<SendResult> {
    if (input.actionKind !== 'voice') throw new Error('Voice delivery requires a voice intent');
    this.requireAutopilotMode(input);
    const { intent, created } = this.options.memoryStore.getSendLedger().createIntentWithStatus(input);
    if (created) this.observeCreated(intent);
    return this.dispatch(intent.id);
  }

  private requireAutopilotMode(input: SendIntentInput): void {
    if (input.sourceKind === 'autopilot' && this.options.memoryStore.getChat(input.chatId)?.agentMode !== 'autopilot') {
      throw new Error('Auto-Pilot send blocked because chat mode is not autopilot');
    }
  }

  async dispatch(id: string, now = Date.now()): Promise<SendResult> {
    const ledger = this.options.memoryStore.getSendLedger();
    const current = ledger.getIntent(id);
    if (!current) throw new Error('Send intent does not exist');
    if (current.state !== 'queued') return this.result(current);

    if (current.sourceKind === 'autopilot' && this.options.memoryStore.getChat(current.chatId)?.agentMode !== 'autopilot') {
      const stopped = ledger.failQueued(id, 'chat_mode_revoked', now);
      if (stopped) this.notify(stopped);
      return this.result(stopped ?? ledger.getIntent(id)!);
    }
    const claimed = ledger.claim(id, this.workerId, now);
    if (!claimed) return this.result(ledger.getIntent(id)!);
    const { intent, attempt } = claimed;
    this.notify(intent);
    let whatsappCallMayHaveStarted = false;
    try {
      // Voice synthesis is deliberately finished before a WhatsApp network attempt starts.
      let sent: { messageId: string };
      if (intent.actionKind === 'voice') {
        if (!this.options.prepareVoice || !this.options.sendVoice) {
          throw new Error('Voice adapter is not configured');
        }
        const audio = await this.options.prepareVoice(intent.text);
        ledger.markNetworkStarted(attempt.id);
        this.observeStage(intent, 'sending', 'ok');
        whatsappCallMayHaveStarted = true;
        sent = await this.options.sendVoice(intent.chatId, audio, {
          replyToMessageId: intent.replyToMessageId
        });
      } else {
        ledger.markNetworkStarted(attempt.id);
        this.observeStage(intent, 'sending', 'ok');
        whatsappCallMayHaveStarted = true;
        sent = await this.options.sendText(intent.chatId, intent.text, {
          replyToMessageId: intent.replyToMessageId,
          simulatedDelayMs: intent.simulatedDelayMs
        });
      }
      if (!sent.messageId) throw new Error('Transport acceptance did not include a native message ID');
      const accepted = ledger.accepted(intent.id, attempt.id, sent.messageId);
      if (!accepted) throw new Error('Send attempt state changed before acceptance could be persisted');
      this.observeStage(accepted, 'accepted', 'ok');
      if (accepted.sourceKind === 'draft') this.options.memoryStore.updateDraftStatus(accepted.sourceId, 'sent');
      this.notify(accepted);
      return this.result(accepted);
    } catch (error) {
      // Only a failure before the WhatsApp call, or its explicit no-socket error,
      // is eligible for automatic retry. Every other failure is ambiguous.
      const explicitPreNetwork = !whatsappCallMayHaveStarted ||
        (typeof error === 'object' && error !== null && 'code' in error &&
          error.code === 'WHATSAPP_NOT_CONNECTED');
      if (explicitPreNetwork) {
        const retryDelay = Math.min(60_000, this.retryBaseMs * 2 ** Math.min(intent.attemptCount - 1, 8));
        const jitter = 0.75 + Math.max(0, Math.min(1, this.random())) * 0.5;
        const retryAt = Date.now() + Math.ceil(retryDelay * jitter);
        const retry = ledger.preSendFailure(intent.id, attempt.id, retryAt, this.maxAttempts);
        if (retry) {
          this.notify(retry);
          return this.result(retry);
        }
      }
      const uncertain = ledger.uncertain(
        intent.id, attempt.id,
        error instanceof Error && error.message === 'Transport acceptance did not include a native message ID'
          ? 'missing_native_message_id' : 'ambiguous_transport_failure'
      );
      if (uncertain) {
        this.observeStage(uncertain, 'sending', 'uncertain');
        this.notify(uncertain);
        return this.result(uncertain);
      }
      // The durable store failed after a possible network call. Never send again here.
      throw error;
    }
  }

  async dispatchDue(now = Date.now(), limit = 20): Promise<SendResult[]> {
    const ledger = this.options.memoryStore.getSendLedger();
    ledger.recoverInterrupted(now);
    const pending = ledger.due(now, limit);
    const results: SendResult[] = [];
    for (const intent of pending) {
      results.push(await this.dispatch(intent.id, now));
    }
    return results;
  }

  async approveDraft(draftId: string, text?: string, policyRevision = 1, asVoice = false): Promise<{ created: boolean; result?: SendResult }> {
    const draft = this.options.memoryStore.getDraft(draftId);
    if (!draft) return { created: false };
    const claim = this.options.memoryStore.getSendLedger().approveDraft(
      draftId, text?.trim() || draft.proposedReply, policyRevision, Date.now(), asVoice ? 'voice' : 'text'
    );
    if (!claim.intent) return { created: false };
    if (!claim.created) return { created: false, result: this.result(claim.intent) };
    this.observeCreated(claim.intent);
    const result = await this.dispatch(claim.intent.id);
    if (result.intent.state === 'accepted') this.options.memoryStore.updateDraftStatus(draftId, 'sent');
    return { created: true, result };
  }

  async retryUncertain(id: string, mutationId: string): Promise<SendResult> {
    const original = this.options.memoryStore.getSendLedger().getIntent(id);
    if (!original || original.state !== 'uncertain') throw new Error('Only uncertain intents can be retried explicitly');
    if (!mutationId.trim()) throw new Error('Retry mutation ID required');
    const request: SendIntentInput = {
      sourceKind: 'ui',
      sourceId: `retry:${id}:${mutationId}`,
      sourceRevision: 1,
      parentIntentId: id,
      actionKind: original.actionKind,
      chatId: original.chatId,
      text: original.text,
      replyToMessageId: original.replyToMessageId,
      policyRevision: original.policyRevision
    };
    const { intent: retry, created } = this.options.memoryStore.getSendLedger().createRetryIntentWithStatus(request);
    if (created) this.observeCreated(retry);
    const result = await this.dispatch(retry.id);
    if (['accepted', 'delivered', 'read'].includes(result.intent.state) && original.sourceKind === 'draft') {
      this.options.memoryStore.updateDraftStatus(original.sourceId, 'sent');
    }
    return result;
  }

  receipt(chatId: string, nativeMessageId: string, status: 'sent' | 'delivered' | 'read'): SendIntent | undefined {
    const intent = this.options.memoryStore.getSendLedger().advanceReceipt(chatId, nativeMessageId, status);
    if (intent) {
      this.observeReceipt(intent, status === 'sent' ? 'accepted' : status);
      this.notify(intent);
    }
    return intent;
  }

  private result(intent: SendIntent): SendResult {
    if (!intent.nativeMessageId) return { intent };
    let message = this.options.memoryStore.getMessage(intent.chatId, intent.nativeMessageId);
    if (!message) {
      message = this.options.memoryStore.addMessage({
        id: intent.nativeMessageId,
        chatId: intent.chatId,
        sender: 'me',
        text: intent.actionKind === 'voice' ? `🎵 [رسالة صوتية صادرة: ${intent.text}]` : intent.text,
        transcription: intent.actionKind === 'voice' ? intent.text : undefined,
        timestamp: intent.updatedAt,
        isFromMe: true,
        type: intent.actionKind === 'voice' ? 'audio' : 'text',
        replyToId: intent.replyToMessageId,
        status: intent.state === 'read' ? 'read' : intent.state === 'delivered' ? 'delivered' : 'sent'
      });
      this.options.publish?.('new_message', message);
    }
    const caughtUp = message.status === 'delivered' || message.status === 'read'
      ? this.options.memoryStore.getSendLedger().advanceReceipt(intent.chatId, intent.nativeMessageId, message.status)
      : undefined;
    if (caughtUp) {
      this.observeReceipt(caughtUp, caughtUp.state === 'read' ? 'read' : 'delivered');
      this.notify(caughtUp);
    }
    return { intent: caughtUp ?? intent, message };
  }

  /** Metrics are advisory and must never change the persisted send result. */
  private observe(intent: SendIntent, record: (diagnostics: DiagnosticsCore) => void): void {
    const diagnostics = this.options.diagnostics;
    if (!diagnostics) return;
    try {
      diagnostics.startTrace({ traceId: intent.id, conversationId: intent.chatId });
      record(diagnostics);
    } catch {
      // Intent and receipt persistence are authoritative even when telemetry fails.
    }
  }

  private observeCreated(intent: SendIntent): void {
    if (intent.state !== 'queued' || intent.attemptCount !== 0) return;
    this.observe(intent, diagnostics => {
      if (!diagnostics.getTrace(intent.id).some(event => event.stage === 'intent_created')) {
        diagnostics.recordStage({ traceId: intent.id, stage: 'intent_created' });
      }
    });
  }

  private observeStage(intent: SendIntent, stage: DiagnosticStage, outcome: DiagnosticOutcome): void {
    this.observe(intent, diagnostics => diagnostics.recordStage({ traceId: intent.id, stage, outcome }));
  }

  private observeReceipt(intent: SendIntent, state: ReceiptState): void {
    this.observe(intent, diagnostics => diagnostics.recordReceipt({ traceId: intent.id, state }));
  }

  private notify(intent: SendIntent): void {
    this.options.publish?.('send_intent', {
      id: intent.id,
      sourceKind: intent.sourceKind,
      sourceId: intent.sourceId,
      chatId: intent.chatId,
      state: intent.state,
      nativeMessageId: intent.nativeMessageId,
      attemptCount: intent.attemptCount,
      updatedAt: intent.updatedAt
    });
  }
}
