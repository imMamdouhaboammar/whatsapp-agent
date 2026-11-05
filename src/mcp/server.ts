import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { AudioTranscriber } from '../ai/audio-transcriber';
import type { ModeratorAgent } from '../ai/moderator-agent';
import type { MemoryStore } from '../domain/memory-store';
import type { WhatsAppSocketClient } from '../transport/whatsapp-socket';

export function createWhatsAppMcpServer(deps: {
  memoryStore: MemoryStore;
  whatsappClient: WhatsAppSocketClient;
  moderatorAgent: ModeratorAgent;
  audioTranscriber?: AudioTranscriber;
}): Server {
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
        }
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

      case 'whatsapp_send_message': {
        const chatId = String(args?.chatId);
        const text = String(args?.text);
        const replyToMessageId = args?.replyToMessageId ? String(args.replyToMessageId) : undefined;

        const sent = await deps.whatsappClient.sendMessage(chatId, text, {
          replyToMessageId,
          simulatedDelayMs: 1500
        });

        // Record into memory store
        deps.memoryStore.addMessage({
          id: sent.messageId,
          chatId,
          sender: 'me',
          text,
          timestamp: Date.now(),
          isFromMe: true,
          type: 'text',
          replyToId: replyToMessageId,
          status: 'sent'
        });

        return {
          content: [
            {
              type: 'text',
              text: `Message sent successfully. ID: ${sent.messageId}`
            }
          ]
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
        const draft = deps.memoryStore.getDraft(draftId);
        if (!draft) {
          throw new Error(`Draft ${draftId} not found`);
        }
        const textToSend = editedText || draft.proposedReply;
        const sent = await deps.whatsappClient.sendMessage(draft.chatId, textToSend, {
          replyToMessageId: draft.incomingMessageId,
          simulatedDelayMs: 1200
        });

        deps.memoryStore.updateDraftStatus(draftId, 'approved', textToSend);
        deps.memoryStore.addMessage({
          id: sent.messageId,
          chatId: draft.chatId,
          sender: 'me',
          text: textToSend,
          timestamp: Date.now(),
          isFromMe: true,
          type: 'text',
          replyToId: draft.incomingMessageId,
          status: 'sent'
        });

        return {
          content: [
            {
              type: 'text',
              text: `Draft ${draftId} approved and sent successfully.`
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
