import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CircuitBreaker } from '../funnel/circuit-breaker';
import { describeError } from '../observability/safe-log';

export type McpTransportType = 'stdio' | 'sse' | 'streamable-http' | 'http';
export type McpToolRisk = 'readOnly' | 'mutating';

export interface McpToolPolicyOverride {
  risk?: McpToolRisk;
  requiresHumanApproval?: boolean;
}

export interface McpServerConfig {
  name: string;
  enabled?: boolean;
  transport: McpTransportType;
  /** Optional tenant/brand isolation. When set, only exposed to matching AGENT_AUTOPILOT_BRAND_ID. */
  brandId?: string;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  /** Fail-closed default: unknown tools default to 'mutating'. */
  defaultRisk?: McpToolRisk;
  /** stdio transport fields */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** sse / streamable-http transport fields */
  url?: string;
  headers?: Record<string, string>;
  /** Per-tool risk / approval overrides keyed by raw tool name. */
  tools?: Record<string, McpToolPolicyOverride>;
}

export interface McpClientsConfig {
  servers: McpServerConfig[];
}

export interface DiscoveredMcpTool {
  namespacedName: string;
  serverName: string;
  rawToolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: McpToolRisk;
  requiresHumanApproval: boolean;
}

export interface McpToolCallResult {
  ok: boolean;
  content: unknown;
  isError?: boolean;
  rawResult?: unknown;
  error?: string;
  durationMs: number;
}

export interface McpServerHealth {
  name: string;
  transport: McpTransportType;
  status: 'connected' | 'disconnected' | 'error' | 'disabled';
  toolCount: number;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  lastError?: string;
}

export interface McpClientLike {
  connect(transport: Transport): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }> }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{ content?: unknown; isError?: boolean }>;
  close(): Promise<void>;
}

export interface McpClientManagerOptions {
  configPath?: string;
  config?: McpClientsConfig;
  brandId?: string;
  defaultTimeoutMs?: number;
  defaultConnectTimeoutMs?: number;
  env?: Readonly<Record<string, string | undefined>>;
  clientFactory?: (server: McpServerConfig) => McpClientLike;
  transportFactory?: (server: McpServerConfig) => Transport;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const DEFAULT_CONFIG_PATH = './config/mcp-clients.json';
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
const SENSITIVE_KEY_RE = /(token|secret|key|auth|password|bearer|cookie|credential)/i;

/**
 * Redacts sensitive values from headers/env objects before logging.
 */
export function scrubSensitiveRecord(record?: Record<string, string>): Record<string, string> | undefined {
  if (!record) return undefined;
  const scrubbed: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    scrubbed[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : v;
  }
  return scrubbed;
}

/**
 * Interpolates `${ENV_VAR}` placeholders using the provided environment map.
 */
export function interpolateEnvPlaceholders(
  value: string,
  env: Readonly<Record<string, string | undefined>>
): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key: string) => env[key] ?? '');
}

function resolveServerEnvPlaceholders(
  server: McpServerConfig,
  env: Readonly<Record<string, string | undefined>>
): McpServerConfig {
  const resolveRecord = (rec?: Record<string, string>) => {
    if (!rec) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) {
      out[k] = interpolateEnvPlaceholders(v, env);
    }
    return out;
  };
  return {
    ...server,
    url: server.url ? interpolateEnvPlaceholders(server.url, env) : undefined,
    command: server.command ? interpolateEnvPlaceholders(server.command, env) : undefined,
    args: server.args?.map((a) => interpolateEnvPlaceholders(a, env)),
    headers: resolveRecord(server.headers),
    env: resolveRecord(server.env)
  };
}

interface ServerConnection {
  config: McpServerConfig;
  client?: McpClientLike;
  transport?: Transport;
  status: McpServerHealth['status'];
  tools: DiscoveredMcpTool[];
  breaker: CircuitBreaker;
  lastError?: string;
}

function classifyToolRisk(
  server: McpServerConfig,
  rawName: string,
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
): { risk: McpToolRisk; requiresHumanApproval: boolean } {
  const override = server.tools?.[rawName];
  const requiresHumanApproval = Boolean(override?.requiresHumanApproval);

  if (override?.risk === 'readOnly' || override?.risk === 'mutating') {
    return { risk: override.risk, requiresHumanApproval };
  }

  // Fail-closed: destructiveHint always wins over readOnlyHint.
  if (annotations?.destructiveHint === true) {
    return { risk: 'mutating', requiresHumanApproval };
  }
  if (annotations?.readOnlyHint === true) {
    return { risk: 'readOnly', requiresHumanApproval };
  }
  if (server.defaultRisk === 'readOnly') {
    return { risk: 'readOnly', requiresHumanApproval };
  }
  return { risk: 'mutating', requiresHumanApproval };
}

function buildNamespacedName(serverName: string, rawToolName: string): string {
  const cleanServer = serverName.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  const cleanTool = rawToolName.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return `${cleanServer}__${cleanTool}`;
}

export class McpClientManager {
  private readonly configPath: string;
  private readonly explicitConfig?: McpClientsConfig;
  private readonly brandId?: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultConnectTimeoutMs: number;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly clientFactory: (server: McpServerConfig) => McpClientLike;
  private readonly transportFactory?: (server: McpServerConfig) => Transport;
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void;

  private readonly connections = new Map<string, ServerConnection>();
  private readonly toolIndex = new Map<string, DiscoveredMcpTool>();
  private initialized = false;

  constructor(options: McpClientManagerOptions = {}) {
    this.env = options.env ?? process.env;
    this.configPath = options.configPath ?? this.env.MCP_CLIENT_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
    this.explicitConfig = options.config;
    this.brandId = options.brandId ?? this.env.AGENT_AUTOPILOT_BRAND_ID;
    this.defaultTimeoutMs =
      options.defaultTimeoutMs ?? (Number(this.env.MCP_TOOL_TIMEOUT_MS) || DEFAULT_TOOL_TIMEOUT_MS);
    this.defaultConnectTimeoutMs = options.defaultConnectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.clientFactory =
      options.clientFactory ??
      (() => new Client({ name: 'fable-whatsapp-agent-client', version: '1.2.0' }, { capabilities: {} }) as unknown as McpClientLike);
    this.transportFactory = options.transportFactory;
    this.log =
      options.log ??
      ((level, msg) => {
        if (level === 'error') console.error(msg);
        else if (level === 'warn') console.warn(msg);
        else console.info(msg);
      });
  }

  private loadConfig(): McpClientsConfig {
    if (this.explicitConfig) return this.explicitConfig;
    if (!this.configPath?.trim()) return { servers: [] };

    try {
      const raw = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<McpClientsConfig>;
      if (!parsed || !Array.isArray(parsed.servers)) {
        this.log('warn', `[McpClientManager] Invalid MCP config at ${this.configPath}: missing servers array`);
        return { servers: [] };
      }
      return { servers: parsed.servers };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return { servers: [] };
      }
      this.log('warn', `[McpClientManager] Failed to load MCP config (${this.configPath}): ${describeError(err)}`);
      return { servers: [] };
    }
  }

  private isBrandAllowed(server: McpServerConfig, activeBrandId?: string): boolean {
    if (!server.brandId) return true;
    const effectiveBrand = activeBrandId ?? this.brandId;
    return Boolean(effectiveBrand && server.brandId === effectiveBrand);
  }

  private createTransport(server: McpServerConfig): Transport {
    if (this.transportFactory) return this.transportFactory(server);

    if (server.transport === 'stdio') {
      if (!server.command) {
        throw new Error(`stdio MCP server '${server.name}' requires 'command'`);
      }
      return new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: server.env ? ({ ...process.env, ...server.env } as Record<string, string>) : undefined,
        cwd: server.cwd
      });
    }

    if (!server.url) {
      throw new Error(`${server.transport} MCP server '${server.name}' requires 'url'`);
    }
    const parsedUrl = new URL(server.url);
    const requestInit = server.headers ? { headers: server.headers } : undefined;

    if (server.transport === 'sse') {
      return new SSEClientTransport(parsedUrl, requestInit ? { requestInit } : undefined);
    }

    return new StreamableHTTPClientTransport(parsedUrl, requestInit ? { requestInit } : undefined);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const config = this.loadConfig();
    if (config.servers.length === 0) return;

    await Promise.allSettled(
      config.servers.map(async (rawServer) => {
        if (!rawServer?.name?.trim()) return;
        const server = resolveServerEnvPlaceholders(rawServer, this.env);
        const conn: ServerConnection = {
          config: server,
          status: 'disconnected',
          tools: [],
          breaker: new CircuitBreaker({
            targetId: `mcp:${server.name}`,
            failureThreshold: 3,
            cooldownMs: 30_000
          })
        };
        this.connections.set(server.name, conn);

        if (server.enabled === false || !this.isBrandAllowed(server)) {
          conn.status = 'disabled';
          return;
        }

        const connectTimeout = server.connectTimeoutMs ?? this.defaultConnectTimeoutMs;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const client = this.clientFactory(server);
          const transport = this.createTransport(server);
          conn.client = client;
          conn.transport = transport;

          await Promise.race([
            (async () => {
              await client.connect(transport);
              const listed = await client.listTools();
              const discovered: DiscoveredMcpTool[] = (listed?.tools ?? []).map((t) => {
                const { risk, requiresHumanApproval } = classifyToolRisk(server, t.name, t.annotations);
                const namespacedName = buildNamespacedName(server.name, t.name);
                return {
                  namespacedName,
                  serverName: server.name,
                  rawToolName: t.name,
                  description: t.description?.trim() || `External MCP tool ${t.name} from ${server.name}`,
                  inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
                  risk,
                  requiresHumanApproval
                };
              });
              conn.tools = discovered;
              for (const tool of discovered) {
                this.toolIndex.set(tool.namespacedName, tool);
              }
              conn.status = 'connected';
            })(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`Connection timed out after ${connectTimeout}ms`)), connectTimeout);
            })
          ]);
        } catch (err) {
          conn.status = 'error';
          conn.lastError = describeError(err);
          this.log(
            'warn',
            `[McpClientManager] External MCP server '${server.name}' unavailable (${conn.lastError}); continuing without its tools`
          );
          try {
            await conn.client?.close();
          } catch {
            // Best-effort cleanup on failed connect
          }
          conn.client = undefined;
        } finally {
          if (timer) clearTimeout(timer);
        }
      })
    );
  }

  listAvailableTools(brandId?: string): DiscoveredMcpTool[] {
    const tools: DiscoveredMcpTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected') continue;
      if (!this.isBrandAllowed(conn.config, brandId)) continue;
      tools.push(...conn.tools);
    }
    return tools;
  }

  getTool(namespacedName: string, brandId?: string): DiscoveredMcpTool | undefined {
    const tool = this.toolIndex.get(namespacedName);
    if (!tool) return undefined;
    const conn = this.connections.get(tool.serverName);
    if (!conn || conn.status !== 'connected') return undefined;
    if (!this.isBrandAllowed(conn.config, brandId)) return undefined;
    return tool;
  }

  async callTool(
    namespacedName: string,
    args: Record<string, unknown> = {},
    options: { timeoutMs?: number; signal?: AbortSignal; brandId?: string } = {}
  ): Promise<McpToolCallResult> {
    const start = performance.now();
    const tool = this.getTool(namespacedName, options.brandId);
    if (!tool) {
      return {
        ok: false,
        content: null,
        error: `External MCP tool '${namespacedName}' is not available`,
        durationMs: Math.round(performance.now() - start)
      };
    }

    const conn = this.connections.get(tool.serverName);
    if (!conn?.client || conn.status !== 'connected') {
      return {
        ok: false,
        content: null,
        error: `External MCP server '${tool.serverName}' is not connected`,
        durationMs: Math.round(performance.now() - start)
      };
    }

    const timeoutMs = options.timeoutMs ?? conn.config.timeoutMs ?? this.defaultTimeoutMs;
    const client = conn.client;

    try {
      const rawResult = await conn.breaker.execute(async () => {
        if (options.signal?.aborted) {
          throw new Error('MCP tool execution aborted');
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            client.callTool({ name: tool.rawToolName, arguments: args }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`MCP tool '${namespacedName}' timed out after ${timeoutMs}ms`)), timeoutMs);
            })
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      });

      const isError = Boolean(rawResult?.isError);
      return {
        ok: !isError,
        isError,
        content: rawResult?.content ?? rawResult,
        rawResult,
        error: isError ? `Tool '${namespacedName}' returned an error response` : undefined,
        durationMs: Math.round(performance.now() - start)
      };
    } catch (err) {
      return {
        ok: false,
        content: null,
        error: err instanceof Error ? err.message : describeError(err),
        durationMs: Math.round(performance.now() - start)
      };
    }
  }

  getHealthReport(): McpServerHealth[] {
    const report: McpServerHealth[] = [];
    for (const conn of this.connections.values()) {
      report.push({
        name: conn.config.name,
        transport: conn.config.transport,
        status: conn.status,
        toolCount: conn.tools.length,
        circuitState: conn.breaker.getState(),
        lastError: conn.lastError
      });
    }
    return report;
  }

  async shutdown(): Promise<void> {
    const closing = Array.from(this.connections.values()).map(async (conn) => {
      if (!conn.client) return;
      try {
        await Promise.race([
          conn.client.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 2000))
        ]);
      } catch {
        // Ignore close errors during shutdown
      } finally {
        conn.client = undefined;
        conn.status = 'disconnected';
      }
    });
    await Promise.allSettled(closing);
    this.toolIndex.clear();
  }
}
