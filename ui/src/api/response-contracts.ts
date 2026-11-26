export type ResponseContract<T> = (value: unknown) => value is T;

type ContractOutput<T> = T extends ResponseContract<infer Value> ? Value : never;
type Fields = Record<string, ResponseContract<unknown>>;
type OptionalKeys<T extends Fields> = {
  [Key in keyof T]: undefined extends ContractOutput<T[Key]> ? Key : never;
}[keyof T];
type ContractObject<T extends Fields> = {
  [Key in Exclude<keyof T, OptionalKeys<T>>]: ContractOutput<T[Key]>;
} & {
  [Key in OptionalKeys<T>]?: ContractOutput<T[Key]>;
};

export const record = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

export function fields<T extends Fields>(properties: T): ResponseContract<ContractObject<T>> {
  return (value): value is ContractObject<T> => record(value)
    && Object.entries(properties).every(([key, matches]) => matches(value[key]));
}

export function array<T>(matches: ResponseContract<T>): ResponseContract<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(matches);
}

export function optional<T>(matches: ResponseContract<T>): ResponseContract<T | undefined> {
  return (value): value is T | undefined => value === undefined || matches(value);
}

function nullable<T>(matches: ResponseContract<T>): ResponseContract<T | null> {
  return (value): value is T | null => value === null || matches(value);
}

function oneOf<const T extends readonly (string | number)[]>(...choices: T): ResponseContract<T[number]> {
  return (value): value is T[number] => choices.some((choice) => choice === value);
}

export const string: ResponseContract<string> = (value): value is string => typeof value === 'string';
export const number: ResponseContract<number> = (value): value is number => typeof value === 'number' && Number.isFinite(value);
export const boolean: ResponseContract<boolean> = (value): value is boolean => typeof value === 'boolean';
const unknownElement: ResponseContract<unknown> = (_value: unknown): _value is unknown => true;
const strings = array(string);
const optionalString = optional(string);
const optionalNumber = optional(number);

const connectedUser = fields({ id: string, name: optionalString, phone: optionalString });
const connectionState = oneOf('disconnected', 'connecting', 'qr_ready', 'pairing_code_ready', 'connected', 'failed');

const pairingStatus = fields({
  state: connectionState,
  qrDataUrl: optionalString,
  pairingCode: optionalString,
  connectedUser: optional(connectedUser),
  error: optionalString,
  pendingDraftsCount: number,
  updatedAt: number,
});
const disabledStatus = fields({
  state: oneOf('disabled'),
  transportMode: string,
  metaCloudConfigured: boolean,
  reason: string,
});

export function systemStatus(value: unknown): value is ReturnTypeFromStatus {
  return pairingStatus(value) || disabledStatus(value);
}
type ReturnTypeFromStatus = ContractOutput<typeof pairingStatus> | ContractOutput<typeof disabledStatus>;

const quotedMessage = fields({
  id: string, sender: string, senderName: optionalString, text: string, type: optionalString,
});
const chatMessage = fields({
  id: string, chatId: string, sender: string, senderName: optionalString, text: string,
  timestamp: number, isFromMe: boolean, type: oneOf('text', 'audio', 'image', 'video', 'document', 'other'),
  mediaUrl: optionalString, transcription: optionalString, replyToId: optionalString,
  quotedMessage: optional(quotedMessage), reactions: optional(strings),
  status: optional(oneOf('pending', 'sent', 'delivered', 'read')), sendIntentId: optionalString,
  deliveryState: optional(oneOf('queued', 'attempting', 'uncertain', 'failed')),
  lastAttemptAt: optionalNumber, nativeMessageId: optionalString,
});

const chatSummary = fields({
  id: string, name: string, phoneNumber: optionalString, unreadCount: number, lastMessage: optionalString,
  lastTimestamp: optionalNumber, isGroup: boolean, agentMode: oneOf('autopilot', 'copilot', 'human'),
  avatarUrl: optionalString,
});

const modelRouting = fields({
  selectedModel: string, tier: oneOf('trivial', 'standard', 'complex'), confidence: number,
  routerLatencyMs: number, reason: string, bypassed: optional(boolean),
});
const agentDecision = fields({
  action: oneOf('reply', 'draft', 'ignore', 'human', 'act'), intent: string, replyText: optionalString,
  reasoning: string, confidence: number, simulatedDelayMs: number, suggestedReaction: optionalString,
  modelRouting: optional(modelRouting),
});
const pendingToolCall = fields({
  namespacedName: string, serverName: string, toolName: string, args: record,
  risk: oneOf('readOnly', 'mutating'), reason: optionalString, proposedFollowUp: optionalString,
});
const agentDraft = fields({
  id: string, chatId: string, incomingMessageId: string, incomingText: string, proposedReply: string,
  sendAsVoiceNote: optional(boolean), reasoning: string, confidence: number,
  status: oneOf('pending', 'approved', 'rejected', 'sent'), createdAt: number,
  modelRouting: optional(modelRouting), toolCall: optional(pendingToolCall),
});
const dossier = fields({
  chatId: string, name: string, phone: optionalString,
  stage: optional(oneOf('lead', 'qualified', 'negotiation', 'customer', 'vip', 'archived')),
  facts: strings, commitments: strings, preferredTone: optionalString, notes: optionalString, updatedAt: number,
});

const persona = fields({
  name: string, language: string, tone: string, systemPrompt: string, rules: strings, model: string,
  temperature: number, minConfidence: number, simulateTypingDelay: boolean, minTypingDelayMs: number,
  maxTypingDelayMs: number, voiceName: optionalString,
});
const policy = fields({
  version: number, defaultAction: string, minConfidence: number,
  rules: array(fields({ id: string, intent: string, effect: oneOf('allow', 'require_approval', 'deny'), action: optionalString })),
});

const funnelMode = oneOf('ALL_SETTLED', 'FIRST_SUCCESS', 'QUORUM');
const funnelMethod = fields({
  method: string, description: string, mode: funnelMode,
  targets: array(fields({ id: string, name: string, enabled: optional(boolean), method: optionalString, timeoutMs: optionalNumber })),
  timeoutMs: number, quorumCount: optionalNumber,
});
const circuitBreaker = fields({
  targetId: string, state: oneOf('CLOSED', 'OPEN', 'HALF_OPEN'),
  consecutiveFailures: number, consecutiveSuccesses: number, totalCalls: number, totalFailures: number,
  lastFailureTime: optionalNumber, lastSuccessTime: optionalNumber, cooldownRemainingMs: optionalNumber,
});
const funnelTargetResult = fields({
  targetId: string, targetName: string, statusCode: number, durationMs: number, success: boolean,
  data: optional(unknownElement), error: optionalString, cancelled: optional(boolean),
});
const contactMemory = fields({ id: string, content: string, created_at: number });
const conversationFold = fields({
  id: string, chatId: string, tier: oneOf(1, 2, 3), topic: string, summary: string,
  startMessageId: string, endMessageId: string, directMessageIds: strings, sourceFoldIds: strings,
  messageCount: number, factsExtracted: strings, createdAt: number, survivedCount: optionalNumber,
  generation: optional(oneOf('young', 'old')),
});
const contextBudget = fields({
  chatId: string, model: string, modelLimitTokens: number, targetContextBudget: number, currentTokens: number,
  tokensSaved: number, compressionRatio: number, activeFoldsCount: number, tier1Count: number, tier2Count: number,
  tier3Count: number, rawMessageCount: number, uncompressedMessageCount: number, preservedRecentCount: number,
  nudgeDecision: oneOf('idle', 'soft', 'strong'),
});

const broadcastContent = fields({
  kind: oneOf('text', 'image', 'video', 'document', 'voice_note', 'template'), messageGoal: string,
  mediaUrl: optionalString, mediaBase64: optionalString, mimeType: optionalString, fileName: optionalString,
  templateName: optionalString, templateLanguage: optionalString,
  templateHeaderMediaType: optional(oneOf('image', 'video', 'document')), templateHeaderMediaUrl: optionalString,
  templateButtons: optional(array(fields({ type: oneOf('url', 'quick_reply'), text: string, urlOrPayload: optionalString }))),
});
const broadcastStats = fields({
  total: number, draft: number, approved: number, queued: number, sent: number, delivered: number,
  read: number, replied: number, followedUp: number, skipped: number, failed: number, optedOut: number,
});
const broadcastCampaign = fields({
  id: string, name: string, goal: string, transport: oneOf('auto', 'baileys', 'meta-cloud'),
  approvalMode: oneOf('preview_approve', 'autonomous'),
  status: oneOf('draft', 'approved', 'running', 'paused', 'completed', 'cancelled'),
  richContent: broadcastContent,
  followUp: fields({
    enabled: boolean, delayMinutes: number, maxFollowUps: number,
    triggerOn: oneOf('read_no_reply', 'delivered_no_reply'), messagePrompt: string,
  }),
  createdBy: oneOf('owner', 'agent'), createdAt: number, updatedAt: number, stats: broadcastStats,
});
const broadcastRecipient = fields({
  id: string, campaignId: string, chatId: string, contactName: string, phoneNumber: optionalString,
  transportUsed: optional(oneOf('baileys', 'meta-cloud')), personalizedText: string, followUpCount: number,
  status: oneOf('draft', 'approved', 'queued', 'sent', 'delivered', 'read', 'replied', 'followed_up', 'skipped', 'failed', 'opted_out'),
  error: optionalString,
});
const eligibleBroadcastContact = fields({
  chatId: string, name: string, phoneNumber: optionalString, stage: string, messageCount: number, lastMessageAtMs: optionalNumber,
});

export const responseContracts = {
  dashboardStatus: fields({ required: boolean, authenticated: boolean }),
  systemStatus,
  dossier: fields({ dossier }),
  updatedDossier: fields({ success: boolean, dossier }),
  status: fields({ status: string }),
  capabilities: fields({ capabilities: array(fields({ capability: string, enabled: boolean, reason: string })) }),
  chats: fields({ chats: array(chatSummary) }),
  chatMessages: fields({ messages: array(chatMessage) }),
  sendMessage: fields({ success: boolean, message: optional(chatMessage), state: string, intentId: string }),
  sendIntent: fields({ success: boolean, state: string, intentId: string }),
  success: fields({ success: boolean }),
  drafts: fields({ drafts: array(agentDraft) }),
  persona: fields({ persona, policy }),
  simulation: fields({
    success: boolean, simulatedMessage: chatMessage, decision: optional(agentDecision),
    draftCreated: optional(agentDraft), shouldSendImmediately: boolean,
  }),
  funnelMethods: fields({ methods: array(funnelMethod) }),
  funnelStats: fields({ circuitBreakers: array(circuitBreaker), activeMethodsCount: number }),
  funnelDispatch: fields({
    traceId: string, method: string, mode: funnelMode, startedAt: string, totalDurationMs: number,
    success: boolean, successfulCount: number, failedCount: number,
    error: optionalString, results: array(funnelTargetResult), winningTargetId: optionalString,
  }),
  circuitBreakerReset: fields({ success: boolean, targetId: string }),
  contactMemories: fields({ memories: array(contactMemory) }),
  savedMemory: fields({ status: string, message: optionalString, memories: optional(array(contactMemory)) }),
  style: fields({ style: string }),
  updatedStyle: fields({ success: boolean, style: string }),
  sticker: fields({
    success: optional(boolean), bytes: optionalNumber, stickerBase64: optionalString,
    error: optionalString, mimeType: optionalString,
  }),
  chatMutation: fields({ success: boolean, chatId: string }),
  workspaceStats: fields({
    chatsCount: number, messagesCount: number, draftsCount: number, memoriesCount: number,
    foldsCount: number, dbSizeBytes: number, connectionState: nullable(connectionState),
    connectedUser: optional(nullable(connectedUser)), transportMode: string,
  }),
  workspaceClean: fields({ success: boolean, freedBytes: number, cleanedItems: strings }),
  workspaceReset: fields({ success: boolean, target: string }),
  contextStatus: fields({ chatId: string, status: nullable(contextBudget) }),
  folds: fields({ chatId: string, folds: array(conversationFold) }),
  foldCompression: fields({ chatId: string, status: string }),
  memorySearch: fields({
    chatId: string, query: string, results: fields({ messages: array(chatMessage), folds: array(conversationFold) }),
  }),
  decompressedFold: fields({ foldId: string, chatId: string, total: number, messages: array(chatMessage) }),
  broadcasts: fields({ campaigns: array(broadcastCampaign) }),
  broadcastAudience: fields({ contacts: array(eligibleBroadcastContact) }),
  broadcastDetails: fields({ campaign: broadcastCampaign, recipients: array(broadcastRecipient) }),
  broadcastRecipient: fields({ recipient: broadcastRecipient }),
  broadcastCampaign: fields({ campaign: broadcastCampaign }),
};
