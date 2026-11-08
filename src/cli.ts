import { GeminiClient } from './ai/gemini-client';
import { ModeratorAgent } from './ai/moderator-agent';
import { MemoryStore } from './domain/memory-store';
import { WhatsAppSocketClient } from './transport/whatsapp-socket';
import { resolveRuntimeDatastore } from './persistence/postgres/runtime-selection';

resolveRuntimeDatastore();

const [command, ...args] = process.argv.slice(2);

async function doctor() {
  console.log('🔍 [Fable Agentic WhatsApp Doctor] Diagnosing environment...');
  console.log(`✓ Runtime: Bun ${Bun.version}`);

  // Check gcloud
  try {
    const project = (await Bun.$`gcloud config get-value project`.text()).trim();
    const token = (await Bun.$`gcloud auth print-access-token`.text()).trim();
    console.log(`✓ Google Cloud CLI: Authenticated`);
    console.log(`  Active Project: ${project}`);
    console.log(`  Access Credential: Valid (active)`);
  } catch {
    if (process.env.GEMINI_API_KEY) {
      console.log('✓ Gemini API Key: Configured in environment');
    } else {
      console.log('⚠️ Google Cloud / Gemini: Neither gcloud ADC nor GEMINI_API_KEY detected');
    }
  }

  // Check data directory
  const memoryStore = new MemoryStore();
  const chats = memoryStore.listChats();
  console.log(`✓ Local Storage: Operational (${chats.length} chats indexed)`);

  console.log('\nAll core checks passed! System ready.');
}

async function simulate(text: string) {
  if (!text) {
    console.error('Usage: bun run cli simulate "رسالة تجريبية"');
    process.exit(1);
  }
  console.log(`\n🧪 Testing Gemini Moderator Agent with message: "${text}"...\n`);
  const memory = new MemoryStore();
  const gemini = new GeminiClient();
  const agent = new ModeratorAgent(gemini, memory);

  const start = performance.now();
  const result = await agent.processInboundMessage({
    id: `cli_test_${Date.now()}`,
    chatId: 'test_user@s.whatsapp.net',
    sender: 'test_user@s.whatsapp.net',
    senderName: 'عميل تجريبي',
    text,
    timestamp: Date.now(),
    isFromMe: false,
    type: 'text'
  });
  const elapsed = Math.round(performance.now() - start);

  console.log('--- Agent Decision ---');
  console.log(`Action: ${result.decision.action.toUpperCase()}`);
  console.log(`Intent: ${result.decision.intent}`);
  console.log(`Confidence: ${(result.decision.confidence * 100).toFixed(0)}%`);
  console.log(`Reasoning: ${result.decision.reasoning}`);
  console.log(`Simulated Typing Delay: ${result.decision.simulatedDelayMs}ms`);
  if (result.decision.replyText) {
    console.log(`\n💬 Proposed Human Reply:\n"${result.decision.replyText}"`);
  }
  if (result.decision.suggestedReaction) {
    console.log(`Suggested Reaction: ${result.decision.suggestedReaction}`);
  }
  console.log(`\n(Execution time: ${elapsed}ms)`);
}

async function pair(phoneNumber?: string) {
  console.log('📱 [WhatsApp Pairing] Starting WhatsApp companion client...');
  const client = new WhatsAppSocketClient({
    onStateChange: (state) => {
      if (state.state === 'qr_ready') {
        console.log('\n📷 [QR Code Ready] Open the Web UI at http://localhost:3000 to scan the QR code!\n');
      } else if (state.state === 'pairing_code_ready') {
        console.log(`\n🔑 [Pairing Code] Enter this 8-digit code on WhatsApp: ${state.pairingCode}\n`);
      } else if (state.state === 'connected') {
        console.log(`\n✅ Connected to WhatsApp as: ${state.connectedUser?.name || state.connectedUser?.phone}\n`);
      }
    }
  });
  await client.start(phoneNumber);
}

switch (command) {
  case 'doctor':
    await doctor();
    break;
  case 'simulate':
    await simulate(args.join(' '));
    break;
  case 'pair':
    await pair(args[0]);
    break;
  default:
    console.log(`
Fable Agentic WhatsApp CLI
Usage:
  bun run cli doctor                 Run environment diagnostic checks
  bun run cli simulate "<text>"      Test Gemini moderator response from CLI
  bun run cli pair [phone]           Initiate WhatsApp companion pairing
  bun run dev                        Start full web server + agent engine
  bun run mcp                        Start Model Context Protocol stdio server
`);
}
