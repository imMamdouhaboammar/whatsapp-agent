import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { AudioTranscriber } from '../ai/audio-transcriber';
import type { ModeratorAgent } from '../ai/moderator-agent';
import type { MemoryStore } from '../domain/memory-store';
import { SendIntentService } from '../domain/send-intent-service';
import type { WhatsAppSocketClient } from '../transport/whatsapp-socket';
import type { FableFunnelEngine } from '../funnel';
import { UserMemoryManager } from '../domain/user-memory';
import type { McpClientManager } from './client-manager';
import { buildTemporalEnvelope, clockTruth } from '../ai/temporal-guard';
import { isRecord, isStringRecord } from './records';

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new Error(field + ' must be a string');
  return value;
};

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, field);
}

type McpToolTransport = Pick<WhatsAppSocketClient, 'getState' | 'sendMessage' | 'sendReaction'>
  & Partial<Pick<WhatsAppSocketClient, 'canonicalizeJid'>>;

/** Tools with no persistent or outbound effect. `whatsapp_get_messages` skips its mark-as-read side effect in read-only mode. */
const READ_ONLY_TOOLS = new Set([
  'whatsapp_list_chats', 'whatsapp_get_messages', 'whatsapp_search_chat_memory',
  'whatsapp_get_chat_folds', 'whatsapp_decompress_fold', 'whatsapp_get_status',
  'whatsapp_get_context_status', 'whatsapp_get_current_time', 'whatsapp_check_temporal_freshness'
]);

export function createWhatsAppMcpServer(deps: {
  memoryStore: MemoryStore;
  whatsappClient: McpToolTransport;
  moderatorAgent: ModeratorAgent;
  audioTranscriber?: AudioTranscriber;
  funnelEngine?: Pick<FableFunnelEngine, 'dispatch'>;
  sendIntents?: SendIntentService;
  mcpClientManager?: McpClientManager;
  /** Expose only tools that cannot change stored state or send anything. */
  readOnly?: boolean;
}): Server {
  let delivery = deps.sendIntents;
  const getDelivery = () => delivery ??= new SendIntentService({
    memoryStore: deps.memoryStore,
    sendText: (chatId, text, options) => deps.whatsappClient.sendMessage(chatId, text, options)
  });
  const server = new Server(
    {
      name: 'fable-agentic-whatsapp',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const all = {
      tools: [
        {
          name: 'whatsapp_list_chats',
          description: 'List recent WhatsApp chats, contacts, unread message counts, and current agent modes.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of chats to return (default 20)'
              },
              unreadOnly: {
                type: 'boolean',
                description: 'Filter only chats with unread messages'
              }
            }
          }
        },
        {
          name: 'whatsapp_get_messages',
          description: 'Retrieve conversation history for a specific WhatsApp chat, including message text, timestamps, and voice note transcriptions.',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: {
                type: 'string',
                description: 'WhatsApp Chat JID (e.g. 123456789@s.whatsapp.net or group JID)'
              },
              limit: {
                type: 'number',
                description: 'Number of recent messages to retrieve (default 20)'
              }
            },
            required: ['chatId']
          }
        },
        {
          name: 'whatsapp_search_chat_memory',
          description: 'Search a single WhatsApp chat in raw messages and summarized historical folds.',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: { type: 'string', description: 'WhatsApp chat JID' },
              query: { type: 'string', description: 'Keyword or phrase (max 200 characters)' },
              limit: { type: 'number', description: 'Maximum results per source (1-50)' }
            },
            required: ['chatId', 'query']
          }
        },
        {
          name: 'whatsapp_get_chat_folds',
          description: 'List historical session, milestone, and archival fold summaries for one chat.',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: { type: 'string', description: 'WhatsApp chat JID' },
              tier: { type: 'number', description: 'Optional tier filter (1: sessions, 2: milestones, 3: archival)' }
            },
            required: ['chatId']
          }
        },
        {
          name: 'whatsapp_get_context_status',
          description: 'Retrieve real-time Dynamic Context Window and Active Context Pruning (ACP) budget status, token usage, compression ratio, active folds count per tier, and pruning recommendations.',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: { type: 'string', description: 'WhatsApp chat JID' }
            },
            required: ['chatId']
          }
        },
        {
          name: 'whatsapp_compress_context_now',
          description: 'Trigger immediate active context pruning and hierarchical folding for a chat to reclaim context window headroom.',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: { type: 'string', description: 'WhatsApp chat JID' }
            },
            required: ['chatId']
          }
        },
        {
          name: 'whatsapp_decompress_fold',
          description: 'Inspect raw messages behind a fold; optionally inspect only a referenced message and two neighbors on each side.',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: { type: 'string', description: 'WhatsApp chat JID' },
              foldId: { type: 'string', description: 'Fold ID from whatsapp_get_chat_folds' },
              aroundMessageId: { type: 'string', description: 'Optional raw message ID to view with two neighbors' },
              offset: { type: 'number', description: 'Pagination offset when viewing a whole fold' },
              limit: { type: 'number', description: 'Maximum fold messages per page (up to 40)' }
            },
            required: ['chatId', 'foldId']
          }
        },
        {
          name: 'whatsapp_send_message',
          description: 'Send a WhatsApp message or reply to a contact as a human moderator with realistic typing delay.',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: {
                type: 'string',
                description: 'WhatsApp Chat JID'
              },
              text: {
                type: 'string',
                description: 'The message text to send'
              },
              replyToMessageId: {
                type: 'string',
                description: 'Optional ID of the message to quote/reply to'
              },
              mutationId: {
                type: 'string',
                description: 'Stable mutation ID for safe retries of this send action'
              }
            },
            required: ['chatId', 'text']
          }
        },
        {
          name: 'whatsapp_send_reaction',
          description: 'React to a WhatsApp message with an emoji (e.g. 👍, ❤️, 🙏, 😂).',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: {
                type: 'string',
                description: 'WhatsApp Chat JID'
              },
              messageId: {
                type: 'string',
                description: 'The ID of the message to react to'
              },
              emoji: {
                type: 'string',
                description: 'The single emoji character to react with'
              }
            },
            required: ['chatId', 'messageId', 'emoji']
          }
        },
        {
          name: 'whatsapp_get_status',
          description: 'Check WhatsApp companion device connection status, authenticated account phone number, and pending moderator drafts.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'whatsapp_set_chat_mode',
          description: 'Set the agent operation mode for a specific chat: autopilot (AI replies automatically), copilot (AI prepares drafts for human approval), or human (AI disabled).',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: {
                type: 'string',
                description: 'WhatsApp Chat JID'
              },
              mode: {
                type: 'string',
                enum: ['autopilot', 'copilot', 'human'],
                description: 'The mode to set for this conversation'
              }
            },
            required: ['chatId', 'mode']
          }
        },
        {
          name: 'whatsapp_approve_draft',
          description: 'Approve and send a pending AI moderator draft reply to the contact.',
          inputSchema: {
            type: 'object',
            properties: {
              draftId: {
                type: 'string',
                description: 'The ID of the pending draft to approve'
              },
              editedText: {
                type: 'string',
                description: 'Optional edited reply text if modified before sending'
              }
            },
            required: ['draftId']
          }
        },
        {
          name: 'whatsapp_manage_memory',
          description: 'Manage explicit contact facts, preferences, and long-term memory (save, list, delete by index, or clear). Intercepts and rejects credentials.',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: {
                type: 'string',
                description: 'Contact WhatsApp JID'
              },
              action: {
                type: 'string',
                enum: ['save', 'list', 'delete', 'clear'],
                description: 'Memory operation to perform'
              },
              content: {
                type: 'string',
                description: 'Fact or preference text to save (required for save action)'
              },
              index: {
                type: 'number',
                description: '1-based index of the memory to delete (required for delete action)'
              }
            },
            required: ['chatId', 'action']
          }
        },
        {
          name: 'whatsapp_set_chat_style',
          description: 'Configure conversational persona and tone for a specific contact: professional, casual, playful, assertive, or empathetic.',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: {
                type: 'string',
                description: 'Contact WhatsApp JID'
              },
              style: {
                type: 'string',
                enum: ['professional', 'casual', 'playful', 'assertive', 'empathetic'],
                description: 'Conversational persona style to set'
              }
            },
            required: ['chatId', 'style']
          }
        },
        {
          name: 'whatsapp_get_current_time',
          description: 'Get the authoritative current system date, time, day of week, and timezone for real-time temporal grounding.',
          inputSchema: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: 'Optional IANA timezone (e.g. Africa/Cairo, Asia/Riyadh, UTC). Defaults to system timezone.'
              }
            }
          }
        },
        {
          name: 'whatsapp_check_temporal_freshness',
          description: 'Classify a message or query into STATIC, VERSIONED, VOLATILE, or LIVE freshness class and build a TemporalEnvelope.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'Message or question to classify for temporal freshness'
              },
              timezone: {
                type: 'string',
                description: 'Optional IANA timezone'
              },
              mode: {
                type: 'string',
                enum: ['balanced', 'strict'],
                description: 'Classification strictness mode'
              }
            },
            required: ['prompt']
          }
        },
        ...(deps.funnelEngine ? [{
          name: 'whatsapp_funnel_scatter_gather',
          description: 'Execute concurrent scatter-gather or hedged race dispatch across multiple external APIs/ERPs/CRMs with automatic circuit breaking and telemetry receipt.',
          inputSchema: {
            type: 'object',
            properties: {
              method: {
                type: 'string',
                description: 'The registered funnel method (e.g. INVENTORY_DISPATCH, WEBHOOK_FANOUT)'
              },
              payload: {
                type: 'object',
                description: 'Optional JSON payload for POST/PUT requests'
              },
              queryParams: {
                type: 'object',
                description: 'Optional query parameters'
              },
              timeoutMs: {
                type: 'number',
                description: 'Optional maximum timeout in ms'
              }
            },
            required: ['method']
          }
        }] : [])
      ]
    };
    return deps.readOnly ? { tools: all.tools.filter((t) => READ_ONLY_TOOLS.has(t.name)) } : all;
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (deps.readOnly && !READ_ONLY_TOOLS.has(name)) {
      return { isError: true, content: [{ type: 'text', text: `Tool ${name} is unavailable in read-only mode (MCP_WHATSAPP_CHANNEL=none).` }] };
    }

    switch (name) {
      case 'whatsapp_list_chats': {
        const limit = Number(args?.limit ?? 20);
        const unreadOnly = Boolean(args?.unreadOnly ?? false);
        let chats = deps.memoryStore.listChats();
        if (unreadOnly) chats = chats.filter((c) => c.unreadCount > 0);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(chats.slice(0, limit), null, 2)
            }
          ]
        };
      }

      case 'whatsapp_get_messages': {
        const chatId = requiredString(args?.chatId, 'chatId');
        const limit = Number(args?.limit ?? 20);
        const messages = deps.memoryStore.getMessages(chatId, limit);
        if (!deps.readOnly) deps.memoryStore.markChatRead(chatId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                messages.map((m) => ({
                  id: m.id,
                  from: m.isFromMe ? 'me' : m.senderName || m.sender,
                  text: m.text,
                  transcription: m.transcription,
                  type: m.type,
                  timestamp: new Date(m.timestamp).toISOString()
                })),
                null,
                2
              )
            }
          ]
        };
      }

      case 'whatsapp_search_chat_memory': {
        const chatId = requiredString(args?.chatId, 'chatId').trim();
        const query = requiredString(args?.query, 'query').trim();
        if (!chatId || !query || query.length > 200) throw new Error('Valid chatId and query are required');
        const limit = Math.max(1, Math.min(50, Math.floor(Number(args?.limit ?? 25)) || 25));
        return {
          content: [{ type: 'text', text: JSON.stringify(deps.memoryStore.searchMemory(chatId, query, limit)) }]
        };
      }

      case 'whatsapp_get_chat_folds': {
        const chatId = requiredString(args?.chatId, 'chatId').trim();
        if (!chatId) throw new Error('chatId is required');
        const tier = args?.tier;
        if (tier !== undefined && tier !== 1 && tier !== 2 && tier !== 3) throw new Error('tier must be 1, 2, or 3');
        return {
          content: [{ type: 'text', text: JSON.stringify(deps.memoryStore.getFolds(chatId, tier)) }]
        };
      }

      case 'whatsapp_get_context_status': {
        const chatId = requiredString(args?.chatId, 'chatId').trim();
        if (!chatId) throw new Error('chatId is required');
        const engine = deps.moderatorAgent.getContextFoldEngine();
        const status = engine?.getContextBudgetStatus(chatId, deps.moderatorAgent.getPersona().model);
        return {
          content: [{ type: 'text', text: JSON.stringify(status ?? { chatId, status: 'unavailable' }) }]
        };
      }

      case 'whatsapp_compress_context_now': {
        const chatId = requiredString(args?.chatId, 'chatId').trim();
        if (!chatId) throw new Error('chatId is required');
        const engine = deps.moderatorAgent.getContextFoldEngine();
        if (!engine) throw new Error('Context fold engine not available');
        const result = await engine.triggerFoldCheck(chatId);
        return {
          content: [{ type: 'text', text: JSON.stringify({ chatId, status: 'triggered', fold: result }) }]
        };
      }

      case 'whatsapp_decompress_fold': {
        const chatId = requiredString(args?.chatId, 'chatId').trim();
        const foldId = requiredString(args?.foldId, 'foldId').trim();
        const aroundId = optionalString(args?.aroundMessageId, 'aroundMessageId') || undefined;
        const fold = deps.memoryStore.getFold(foldId);
        if (!chatId || !fold || fold.chatId !== chatId) throw new Error('Fold not found in chat');
        const raw = deps.memoryStore.getFoldMessages(foldId);
        if (aroundId && !fold.directMessageIds.includes(aroundId)) throw new Error('Message outside selected fold');
        const offset = Math.max(0, Math.min(512, Math.floor(Number(args?.offset ?? 0)) || 0));
        const limit = Math.max(1, Math.min(40, Math.floor(Number(args?.limit ?? 40)) || 40));
        const messages = aroundId
          ? deps.memoryStore.getMessageWindow(chatId, aroundId, 2)
          : raw.slice(offset, offset + limit);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            foldId, chatId, total: raw.length, offset: aroundId ? undefined : offset, messages
          }) }]
        };
      }

      case 'whatsapp_send_message': {
        const requestedChatId = requiredString(args?.chatId, 'chatId');
        const text = requiredString(args?.text, 'text');
        if (!text.trim()) throw new Error('Message text is required');
        const replyToMessageId = optionalString(args?.replyToMessageId, 'replyToMessageId') || undefined;
        const mutationId = optionalString(args?.mutationId, 'mutationId') || crypto.randomUUID();
        const chatId = deps.whatsappClient.canonicalizeJid
          ? await deps.whatsappClient.canonicalizeJid(requestedChatId)
          : requestedChatId;
        const result = await getDelivery().sendText({
          sourceKind: 'mcp',
          sourceId: mutationId,
          sourceRevision: 1,
          actionKind: 'text',
          chatId,
          text,
          replyToMessageId,
          policyRevision: 1
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              intentId: result.intent.id,
              state: result.intent.state,
              messageId: result.intent.nativeMessageId ?? null,
              needsReconciliation: result.intent.state === 'uncertain'
            })
          }]
        };
      }

      case 'whatsapp_send_reaction': {
        const chatId = requiredString(args?.chatId, 'chatId');
        const messageId = requiredString(args?.messageId, 'messageId');
        const emoji = requiredString(args?.emoji, 'emoji');
        await deps.whatsappClient.sendReaction(chatId, messageId, emoji);
        return {
          content: [
            {
              type: 'text',
              text: `Reaction ${emoji} added to message ${messageId}`
            }
          ]
        };
      }

      case 'whatsapp_get_status': {
        const state = deps.whatsappClient.getState();
        const pendingDrafts = deps.memoryStore.getPendingDrafts();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  connectionState: state.state,
                  connectedUser: state.connectedUser,
                  pendingDraftsCount: pendingDrafts.length,
                  persona: deps.moderatorAgent.getPersona().name
                },
                null,
                2
              )
            }
          ]
        };
      }

      case 'whatsapp_set_chat_mode': {
        const chatId = requiredString(args?.chatId, 'chatId');
        const mode = args?.mode;
        if (mode !== 'autopilot' && mode !== 'copilot' && mode !== 'human') throw new Error('Invalid mode');
        deps.memoryStore.setChatMode(chatId, mode);
        return {
          content: [
            {
              type: 'text',
              text: `Chat ${chatId} mode updated to ${mode}`
            }
          ]
        };
      }

      case 'whatsapp_approve_draft': {
        const draftId = requiredString(args?.draftId, 'draftId');
        let editedText = optionalString(args?.editedText, 'editedText') || undefined;
        const draft = deps.memoryStore.getDraft(draftId);
        if (draft?.toolCall && draft.status === 'pending') {
          if (!deps.mcpClientManager) {
            throw new Error('External MCP client manager is not configured to execute tool draft');
          }
          const toolResult = await deps.mcpClientManager.callTool(draft.toolCall.namespacedName, draft.toolCall.args);
          if (!toolResult.ok) {
            throw new Error(toolResult.error || `External MCP tool '${draft.toolCall.namespacedName}' failed`);
          }
          if (!editedText && !draft.proposedReply.trim()) {
            editedText = draft.toolCall.proposedFollowUp?.trim() || `Done — executed ${draft.toolCall.toolName}.`;
          }
        }
        const approved = await getDelivery().approveDraft(draftId, editedText);
        if (!approved.result) throw new Error(`Draft ${draftId} not found or already processed`);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              draftId,
              approved: approved.created,
              intentId: approved.result.intent.id,
              state: approved.result.intent.state,
              messageId: approved.result.intent.nativeMessageId ?? null
            })
          }]
        };
      }

      case 'whatsapp_manage_memory': {
        const chatId = requiredString(args?.chatId, 'chatId');
        const action = args?.action;
        if (action !== 'save' && action !== 'list' && action !== 'delete' && action !== 'clear') throw new Error('Invalid action');
        const content = optionalString(args?.content, 'content') || undefined;
        const index = args?.index ? Number(args.index) : undefined;

        const manager = new UserMemoryManager(deps.memoryStore.getSqliteStore());
        let commandText = '';
        if (action === 'save') {
          commandText = `Remember that ${content}`;
        } else if (action === 'list') {
          commandText = 'What do you remember about me?';
        } else if (action === 'delete') {
          commandText = `Forget memory #${index || 1}`;
        } else if (action === 'clear') {
          commandText = 'Clear all memories';
        }

        const brandId = 'default';
        const res = await manager.handleCommand(brandId, chatId, commandText);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(res, null, 2)
            }
          ]
        };
      }

      case 'whatsapp_set_chat_style': {
        const chatId = requiredString(args?.chatId, 'chatId');
        const style = args?.style;
        if (style !== 'professional' && style !== 'casual' && style !== 'playful' && style !== 'assertive' && style !== 'empathetic') {
          throw new Error('Invalid style');
        }
        deps.memoryStore.setChatStyle(chatId, style);

        return {
          content: [
            {
              type: 'text',
              text: `Chat ${chatId} conversation style updated to ${style}`
            }
          ]
        };
      }

      case 'whatsapp_get_current_time': {
        const timezone = optionalString(args?.timezone, 'timezone') || 'system';
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(clockTruth({ timezone }), null, 2)
            }
          ]
        };
      }

      case 'whatsapp_check_temporal_freshness': {
        const prompt = requiredString(args?.prompt, 'prompt');
        const timezone = optionalString(args?.timezone, 'timezone') || 'system';
        const mode = args?.mode === 'strict' ? 'strict' : 'balanced';
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(buildTemporalEnvelope(prompt, { timezone, mode }), null, 2)
            }
          ]
        };
      }

      case 'whatsapp_funnel_scatter_gather': {
        if (!deps.funnelEngine) {
          throw new Error('Funnel engine is not initialized');
        }
        const method = requiredString(args?.method, 'method');
        const { payload, queryParams } = args ?? {};
        if (payload !== undefined && !isRecord(payload)) throw new Error('payload must be an object');
        if (queryParams !== undefined && !isStringRecord(queryParams)) throw new Error('queryParams must be an object with string values');
        const receipt = await deps.funnelEngine.dispatch({
          method,
          payload,
          queryParams,
          timeoutMs: args?.timeoutMs ? Number(args.timeoutMs) : undefined
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(receipt, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}
