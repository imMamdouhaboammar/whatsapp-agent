import { describeError } from '../observability/safe-log';
import type {ChatMessage} from '../domain/types';
import type {ModeratorAgent} from '../ai/moderator-agent';
import type {MemoryStore} from '../domain/memory-store';
import type {AutonomousOperator} from './autonomous-operator';
import type {InboundPlanner} from './inbound-planner';
import type {JevRouteRequest, RoutingDecision} from '../ai/model-router';
import {ConversationQueueError, ExecutionQueue} from './execution-queue';
import {hashChatId, logEvent} from '../observability/safe-log';

type DecisionResult=Awaited<ReturnType<ModeratorAgent['processInboundMessage']>>;
type CoordinatorDependencies={
  moderator:Pick<ModeratorAgent,'processInboundMessage'>;
  memory:Pick<MemoryStore,'getChat'>;
  operator:Pick<AutonomousOperator,'resolve'>;
  /** Explicit owner opt-in supplied by createInboundPlanner. */
  planner?:Pick<InboundPlanner,'process'>;
  brandId?:string;
  enabled:boolean;
  router?:(input:JevRouteRequest)=>Promise<RoutingDecision>;
};
/** Opt-in verified-data lane; general conversation and sensitive decisions retain moderator policy. */
export class AgentTurnCoordinator {
  private readonly queue: ExecutionQueue;
  private readonly turnTimeoutMs: number;
  constructor(private readonly deps:CoordinatorDependencies, options: { turnTimeoutMs?: number; maxChats?: number } = {}){
    this.turnTimeoutMs = options.turnTimeoutMs ?? 45_000;
    this.queue = new ExecutionQueue({ timeoutMs: this.turnTimeoutMs, maxKeys: options.maxChats ?? 1000 });
  }
  async processInboundMessage(message:ChatMessage,delivery?:{historical?:boolean;replayed?:boolean}):Promise<DecisionResult>{
    if(delivery?.historical||delivery?.replayed)return {
      decision:{action:'ignore',intent:'replay',reasoning:'Historical or replayed inbound message',confidence:1,simulatedDelayMs:0},
      shouldSendImmediately:false
    };

    let release:()=>void;
    try {
      release = await this.queue.acquire(message.chatId);
    } catch (err) {
      if (err instanceof ConversationQueueError) {
        // A queued turn whose wait expired must never process next to the
        // still-active predecessor (WA-001/WA-002). Fail closed without any
        // side effect; durable recovery of dropped intake is WA-005's scope.
        // Admission rejections stay distinguishable from wait timeouts and
        // are logged server-side so operators see the pressure signal.
        logEvent('warn', 'turn_queue_rejected', { chat: hashChatId(message.chatId), reason: err.reason });
        return {
          decision:{action:'ignore',intent: err.reason === 'admission_full' ? 'admission_full' : 'turn_queue_expired',reasoning:`Turn not started: ${err.message}`,confidence:1,simulatedDelayMs:0},
          shouldSendImmediately:false
        };
      }
      throw err;
    }

    // Ownership is released only when the underlying turn actually settles.
    // A timed-out Promise is not a cancelled operation: an expired turn keeps
    // exclusive ownership of the chat so no successor can overlap its late
    // tool writes, and its eventual result is discarded rather than published.
    const processPromise = this.process(message);
    void processPromise.then(() => release(), () => release());

    let turnTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        processPromise,
        new Promise<never>((_, reject) => {
          turnTimer = setTimeout(() => reject(new Error(`Agent turn timed out after ${this.turnTimeoutMs}ms`)), this.turnTimeoutMs);
        })
      ]);
    }
    catch (err: any) {
      // Fail closed with an ignore decision: a timed-out turn must not publish,
      // send, or masquerade as a persisted draft.
      return {
        decision: {
          action: 'ignore',
          intent: 'processing_timeout',
          reasoning: `Turn processing error or timeout (${describeError(err)})`,
          confidence: 0,
          simulatedDelayMs: 0
        },
        shouldSendImmediately: false
      };
    }
    finally {
      if (turnTimer) clearTimeout(turnTimer);
    }
  }
  private async process(message:ChatMessage):Promise<DecisionResult>{
    const activeMode=this.deps.memory.getChat(message.chatId)?.agentMode??'autopilot';
    if(this.deps.planner&&activeMode==='autopilot'&&!message.isFromMe&&message.type==='text'&&
       !message.chatId.endsWith('@g.us')){
      try{
        const planned=await this.deps.planner.process(message);
        if(planned)return planned;
      }catch{
        // A failed durable replay guard may conceal a completed provider write.
        return {decision:{action:'ignore',intent:'provider_unknown',reasoning:'Inbound planner failed closed',confidence:1,simulatedDelayMs:0},shouldSendImmediately:false};
      }
    }
    const validBrand=!!this.deps.brandId && /^[A-Za-z0-9_-]{1,64}$/.test(this.deps.brandId);
    const readOnlyStock=/\bSKU[-_][A-Za-z0-9_-]{1,80}\b/i.test(message.text??'');
    const permitted=this.deps.enabled && validBrand && activeMode==='autopilot' &&
      !message.isFromMe && message.type==='text' && !message.chatId.endsWith('@g.us') && readOnlyStock;
    if(!permitted)return this.deps.moderator.processInboundMessage(message);
    try{
      const resolved=await this.deps.operator.resolve({
        brandId:this.deps.brandId!,contactId:message.chatId,text:message.text,
        workflowId:message.chatId+':'+message.id
      });
      const confirmed=resolved.status==='answered' && resolved.evidence.some(e=>e.kind==='provider');
      if(confirmed && resolved.reply.trim()){
        return {
          decision:{
            action:'reply',intent:'general_faq',replyText:resolved.reply,
            reasoning:'Verified read-only inventory connector',confidence:1,
            simulatedDelayMs:0,sendAsVoiceNote:false
          },shouldSendImmediately:true
        };
      }
    }catch{ /* provider/model failures retain the existing moderation path */ }
    return this.deps.moderator.processInboundMessage(message);
  }
}
