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
import type { ConversationStyle } from '../ai/adaptive-style';

export function createWhatsAppMcpServer(deps: {
  memoryStore: MemoryStore;
  whatsappClient: WhatsAppSocketClient;
  moderatorAgent: ModeratorAgent;
  audioTranscriber?: AudioTranscriber;
  funnelEngine?: FableFunnelEngine;
  sendIntents?: SendIntentService;
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
    return {
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
          description: 'List historical session and milestone fold summaries for one chat.',
          inputSchema: {
            type: 'object',
            properties: { chatId: { type: 'string', description: 'WhatsApp chat JID' } },
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
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

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
        const chatId = String(args?.chatId);
        const limit = Number(args?.limit ?? 20);
        const messages = deps.memoryStore.getMessages(chatId, limit);
        deps.memoryStore.markChatRead(chatId);
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
        const chatId = String(args?.chatId ?? '').trim();
        const query = String(args?.query ?? '').trim();
        if (!chatId || !query || query.length > 200) throw new Error('Valid chatId and query are required');
        const limit = Math.max(1, Math.min(50, Math.floor(Number(args?.limit ?? 25)) || 25));
        return {
          content: [{ type: 'text', text: JSON.stringify(deps.memoryStore.searchMemory(chatId, query, limit)) }]
        };
      }

      case 'whatsapp_get_chat_folds': {
        const chatId = String(args?.chatId ?? '').trim();
        if (!chatId) throw new Error('chatId is required');
        return {
          content: [{ type: 'text', text: JSON.stringify(deps.memoryStore.getFolds(chatId)) }]
        };
      }

      case 'whatsapp_decompress_fold': {
        const chatId = String(args?.chatId ?? '').trim();
        const foldId = String(args?.foldId ?? '').trim();
        const fold = deps.memoryStore.getFold(foldId);
        if (!chatId || !fold || fold.chatId !== chatId) throw new Error('Fold not found in chat');
        const raw = deps.memoryStore.getFoldMessages(foldId);
        const aroundId = args?.aroundMessageId ? String(args.aroundMessageId) : undefined;
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
        const chatId = deps.whatsappClient.canonicalizeJid
          ? await deps.whatsappClient.canonicalizeJid(String(args?.chatId))
          : String(args?.chatId);
        const text = String(args?.text ?? '');
        if (!text.trim()) throw new Error('Message text is required');
        const replyToMessageId = args?.replyToMessageId ? String(args.replyToMessageId) : undefined;
        const result = await getDelivery().sendText({
          sourceKind: 'mcp',
          sourceId: String(args?.mutationId || crypto.randomUUID()),
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
        const chatId = String(args?.chatId);
        const messageId = String(args?.messageId);
        const emoji = String(args?.emoji);
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
        const chatId = String(args?.chatId);
        const mode = args?.mode as any;
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
        const draftId = String(args?.draftId);
        const editedText = args?.editedText ? String(args.editedText) : undefined;
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
        const chatId = String(args?.chatId);
        const action = String(args?.action) as 'save' | 'list' | 'delete' | 'clear';
        const content = args?.content ? String(args.content) : undefined;
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
        const chatId = String(args?.chatId);
        const style = String(args?.style) as ConversationStyle;
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

      case 'whatsapp_funnel_scatter_gather': {
        if (!deps.funnelEngine) {
          throw new Error('Funnel engine is not initialized');
        }
        const method = String(args?.method);
        const receipt = await deps.funnelEngine.dispatch({
          method,
          payload: (args?.payload as any) || undefined,
          queryParams: (args?.queryParams as any) || undefined,
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
