import { GeminiClient } from './ai/gemini-client';
import { ModeratorAgent } from './ai/moderator-agent';
import { MemoryStore } from './domain/memory-store';
import { WhatsAppSocketClient } from './transport/whatsapp-socket';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDoctorReport, runDoctor, verifyBaileysPatch } from './doctor';
import { resolveRuntimeDatastore } from './persistence/postgres/runtime-selection';
import { McpClientManager } from './mcp/client-manager';

resolveRuntimeDatastore();

const [command, ...args] = process.argv.slice(2);

function runGcloud(gcloudArgs: string[]) {
  const proc = Bun.spawn(['gcloud', ...gcloudArgs], { stdout: 'pipe', stderr: 'pipe', timeout: 15_000, killSignal: 'SIGKILL' });
  return Promise.all([Bun.readableStreamToText(proc.stdout), proc.exited]);
}

async function doctor(flags: string[]) {
  console.log('🔍 [Fable Agentic WhatsApp Doctor] Diagnosing environment...\n');
  const preflightOnly = flags.includes('--preflight');
  // The app, `pair` and MCP all use ./data (DATA_DIR is not read anywhere), so probe the same place.
  const dataDir = './data';
  const report = await runDoctor({
    bunVersion: Bun.version,
    env: process.env,
    openStorage: () => new MemoryStore().listChats().length,
    // WA-011: prove a write commits instead of trusting a stats read.
    testStorageWrite: () => new MemoryStore().verifyWriteCommit(),
    baileysPatched: () => {
      try {
        const content = readFileSync('./node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js', 'utf8');
        return verifyBaileysPatch(content);
      } catch {
        return false;
      }
    },
    // WA-011: key presence is not validity; list models with the key, bounded.
    verifyModelKey: async () => {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return false;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`, {
        signal: AbortSignal.timeout(8000)
      });
      return res.status === 200;
    },
    uiBuilt: () => existsSync('./ui/dist/index.html'),
    gcloudAuthenticated: async () => {
      // Same path GeminiClient uses: active gcloud account token plus a project. Bounded so a stuck helper cannot hang the doctor.
      const [token, tokenExit] = await runGcloud(['auth', 'print-access-token']);
      if (tokenExit !== 0 || token.trim().length < 20) throw new Error('gcloud could not print an access token (or timed out)');
      if (process.env.GOOGLE_CLOUD_PROJECT) return true;
      const [project] = await runGcloud(['config', 'get-value', 'project']);
      if (!project.trim()) throw new Error('no Google Cloud project is set');
      return true;
    },
    sessionPaired: () => {
      try {
        const creds = JSON.parse(readFileSync(join(dataDir, 'session', 'creds.json'), 'utf8'));
        return creds?.registered === true;
      } catch { return false; }
    },
    checkExternalMcp: async () => {
      const mcp = new McpClientManager();
      try {
        await mcp.initialize();
        return mcp.getHealthReport();
      } finally {
        await mcp.shutdown();
      }
    }
  }, { preflightOnly, strict: flags.includes('--strict') });
  console.log(formatDoctorReport(report, { preflightOnly }));
  process.exitCode = report.exitCode;
}

async function simulate(text: string) {
  if (!text) {
    console.error('Usage: bun run cli simulate "رسالة تجريبية"');
    process.exit(1);
  }
  console.log(`\n🧪 Testing Gemini Moderator Agent with message: "${text}"...\n`);
  const memory = new MemoryStore();
  const gemini = new GeminiClient();
  const mcpManager = new McpClientManager();
  await mcpManager.initialize();
  const agent = new ModeratorAgent(gemini, memory, { mcpClientManager: mcpManager });

  const start = performance.now();
  let result;
  try {
    result = await agent.processInboundMessage({
      id: `cli_test_${Date.now()}`,
      chatId: 'test_user@s.whatsapp.net',
      sender: 'test_user@s.whatsapp.net',
      senderName: 'عميل تجريبي',
      text,
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    }, { dryRun: true });
  } finally {
    await mcpManager.shutdown();
  }
  const elapsed = Math.round(performance.now() - start);

  console.log('--- Agent Decision ---');
  if (result.decision.modelRouting) {
    const r = result.decision.modelRouting;
    console.log(`Model Routing (Jev): [${r.tier.toUpperCase()}] -> ${r.selectedModel} (confidence: ${(r.confidence * 100).toFixed(0)}%, latency: ${r.routerLatencyMs}ms)`);
  }
  console.log(`Action: ${result.decision.action.toUpperCase()}`);
  console.log(`Intent: ${result.decision.intent}`);
  console.log(`Confidence: ${(result.decision.confidence * 100).toFixed(0)}%`);
  console.log(`Reasoning: ${result.decision.reasoning}`);
  if (result.decision.externalToolCalls?.length) {
    console.log('External MCP Tools:');
    for (const tc of result.decision.externalToolCalls) {
      console.log(`  - ${tc.namespacedName} [${tc.risk}] -> ${tc.decision}${tc.ok !== undefined ? ` (ok=${tc.ok})` : ''}`);
    }
  }
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
    await doctor(args);
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
  bun run cli doctor [--preflight] [--strict]
                                     Install preflight plus live readiness; exits 1 on any failure
  bun run cli simulate "<text>"      Test Gemini moderator response from CLI
  bun run cli pair [phone]           Initiate WhatsApp companion pairing
  bun run dev                        Start full web server + agent engine
  bun run mcp                        Start Model Context Protocol stdio server
`);
}
