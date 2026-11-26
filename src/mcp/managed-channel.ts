import type { PairingState } from '../domain/types';
import type { WhatsAppSocketClient } from '../transport/whatsapp-socket';

/** Everything the tool server calls on the client, so a lifecycle-only fake cannot be cast into it. */
export type ManagedChannelClient = Pick<WhatsAppSocketClient, 'start' | 'getState' | 'disconnect' | 'sendMessage' | 'sendReaction'>;

export interface ManagedChannelOptions<C extends ManagedChannelClient> {
  /** Builds the transport client. Receives a state listener the channel uses to detect readiness. */
  createClient: (onStateChange: (state: PairingState) => void) => C;
  /** Bounded wait for the first `connected` state. Default 20s. */
  connectTimeoutMs?: number;
  /** Diagnostics go to stderr only: stdout belongs to the MCP stdio protocol. */
  log?: (message: string) => void;
}

export interface ManagedChannel<C extends ManagedChannelClient> {
  client: C;
  /** True when the channel reported `connected` within the timeout. */
  connected: boolean;
  stop: () => Promise<void>;
}

/**
 * Owns the lifecycle of the WhatsApp transport for a standalone MCP process.
 * It starts the client, waits a bounded time for `connected`, and never throws for
 * a slow or failed connection: the MCP tools report the real state instead of
 * pretending to be connected.
 */
export async function startManagedChannel<C extends ManagedChannelClient>(
  options: ManagedChannelOptions<C>
): Promise<ManagedChannel<C>> {
  const log = options.log ?? ((m: string) => console.error(m));
  const timeoutMs = options.connectTimeoutMs ?? 20_000;
  let resolveConnected: ((value: true) => void) | undefined;
  const connectedSignal = new Promise<true>((resolve) => {
    resolveConnected = resolve;
  });

  const client = options.createClient((state) => {
    if (state.state === 'connected') resolveConnected?.(true);
    if (state.state === 'qr_ready' || state.state === 'pairing_code_ready') {
      log('[MCP channel] Pairing required: run `bun run cli pair` or pair through the web cockpit first.');
    }
  });

  // start() can stall on auth loading or the Baileys version lookup, so it runs under the same bounded
  // wait as the connection, and a start that fails ends the wait immediately instead of burning the timeout.
  const startFailed = client.start().then(() => new Promise<never>(() => {})).catch((err: unknown) => {
    log(`[MCP channel] Failed to start WhatsApp transport: ${err instanceof Error ? err.message : String(err)}`);
    return false as const;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const connected = client.getState().state === 'connected' || await Promise.race([connectedSignal, startFailed, timeout]);
  if (timer) clearTimeout(timer);

  if (!connected) {
    log(`[MCP channel] Not connected after ${timeoutMs}ms (state: ${client.getState().state}). Send tools will report this state.`);
  }

  return { client, connected, stop: () => client.disconnect() };
}
