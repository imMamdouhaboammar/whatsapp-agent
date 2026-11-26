import type { ChatContent, GeminiClient, GeminiGenerateOptions } from '../ai/gemini-client';
import { executeWithModelFallback, resolveModelChain } from '../ai/model-fallback';
import { evaluateMcpToolPermission } from '../domain/permission-engine';
import type { AgentMode } from '../domain/types';
import type { DiscoveredMcpTool, McpClientManager, McpToolCallResult } from './client-manager';
import { isRecord } from './records';

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'additionalProperties',
  'propertyNames',
  'patternProperties',
  'unevaluatedProperties',
  'contentEncoding',
  'contentMediaType',
  'default',
  'examples',
  'title',
  'readOnly',
  'writeOnly',
  'deprecated'
]);

/**
 * Recursively sanitizes a JSON Schema node into a Gemini FunctionDeclaration-compatible schema.
 */
export function sanitizeSchemaForGemini(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    return { type: 'object', properties: {} };
  }

  // Unwrap simple anyOf / oneOf union types (e.g. nullable fields)
  const variants: unknown = Array.isArray(input.anyOf) ? input.anyOf : input.oneOf;
  if (Array.isArray(variants)) {
    const nonNull = variants.find(
      (v: unknown) => isRecord(v) && v.type !== 'null'
    );
    if (nonNull) {
      const sanitized = sanitizeSchemaForGemini(nonNull);
      if (typeof input.description === 'string' && !sanitized.description) {
        sanitized.description = input.description;
      }
      return sanitized;
    }
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;

    if (key === 'type' && Array.isArray(value)) {
      const primary = value.find((t) => t !== 'null');
      out.type = typeof primary === 'string' ? primary : 'string';
      if (value.includes('null')) out.nullable = true;
      continue;
    }

    if (key === 'properties' && isRecord(value)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = sanitizeSchemaForGemini(propSchema);
      }
      out.properties = props;
      continue;
    }

    if (key === 'items' && value && typeof value === 'object') {
      out.items = sanitizeSchemaForGemini(value);
      continue;
    }

    out[key] = value;
  }

  if (!out.type) {
    out.type = out.properties ? 'object' : 'string';
  }
  if (out.type === 'object' && !out.properties) {
    out.properties = {};
  }

  return out;
}

/**
 * Converts discovered MCP tools into Gemini FunctionDeclaration objects.
 */
export function toGeminiFunctionDeclarations(tools: DiscoveredMcpTool[]): GeminiFunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.namespacedName,
    description: tool.description.slice(0, 1024),
    parameters: sanitizeSchemaForGemini(tool.inputSchema)
  }));
}

export interface ToolLoopTraceEntry {
  namespacedName: string;
  serverName: string;
  rawToolName: string;
  args: Record<string, unknown>;
  risk: 'readOnly' | 'mutating';
  decision: 'execute' | 'require_approval' | 'deny' | 'dry_run_skipped';
  ok?: boolean;
  error?: string;
  durationMs?: number;
}

export interface PendingMcpToolApproval {
  namespacedName: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  risk: 'readOnly' | 'mutating';
  reason: string;
}

export interface GeminiToolLoopResult {
  status: 'completed' | 'approval_required' | 'blocked_human';
  text: string;
  activeModel: string;
  iterations: number;
  toolTrace: ToolLoopTraceEntry[];
  pendingApproval?: PendingMcpToolApproval;
}

export interface GeminiToolLoopOptions {
  gemini: Pick<GeminiClient, 'generateContent'>;
  mcpManager: Pick<McpClientManager, 'callTool'>;
  tools: DiscoveredMcpTool[];
  contents: ChatContent[];
  agentMode: AgentMode;
  generateOptions?: Omit<GeminiGenerateOptions, 'functionDeclarations' | 'googleSearch'>;
  preferredModel?: string;
  fallbackModels?: string[];
  maxIterations?: number;
  dryRun?: boolean;
  brandId?: string;
}

const DEFAULT_MAX_TOOL_HOPS = 5;

/**
 * Executes a multi-step Gemini function-calling loop against external MCP tools,
 * enforcing permission boundaries and bounded hop counts.
 */
export async function executeGeminiToolLoop(options: GeminiToolLoopOptions): Promise<GeminiToolLoopResult> {
  const maxIterations = Math.max(1, options.maxIterations ?? DEFAULT_MAX_TOOL_HOPS);
  const toolMap = new Map(options.tools.map((t) => [t.namespacedName, t]));
  const functionDeclarations = toGeminiFunctionDeclarations(options.tools);
  const conversation: ChatContent[] = options.contents.map((c) => ({
    role: c.role,
    parts: [...c.parts]
  }));

  const preferred = options.preferredModel || options.generateOptions?.model || 'gemini-4-argon';
  const modelChain = options.fallbackModels?.length
    ? options.fallbackModels
    : resolveModelChain(preferred, process.env.GEMINI_FALLBACK_MODELS);

  const toolTrace: ToolLoopTraceEntry[] = [];
  let activeModel = preferred;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;
    const fallbackRes = await executeWithModelFallback(
      modelChain,
      (model) =>
        options.gemini.generateContent(conversation, {
          ...options.generateOptions,
          model,
          functionDeclarations
        }),
      { preferredModel: preferred, provider: 'gemini', lane: 'interactive' }
    );
    activeModel = fallbackRes.activeModel;
    const response = fallbackRes.result;
    const calls = response.functionCalls ?? [];

    if (calls.length === 0) {
      return {
        status: 'completed',
        text: response.text,
        activeModel,
        iterations,
        toolTrace
      };
    }

    conversation.push({
      role: 'model',
      parts: calls.map((fc) => ({ functionCall: { name: fc.name, args: fc.args } }))
    });

    const responseParts: Array<{ functionResponse: { name: string; response: unknown } }> = [];

    for (const fc of calls) {
      const tool = toolMap.get(fc.name);
      if (!tool) {
        toolTrace.push({
          namespacedName: fc.name,
          serverName: 'unknown',
          rawToolName: fc.name,
          args: fc.args ?? {},
          risk: 'mutating',
          decision: 'deny',
          ok: false,
          error: 'Unknown external tool'
        });
        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: { error: `Unknown tool '${fc.name}'` }
          }
        });
        continue;
      }

      const perm = evaluateMcpToolPermission({
        agentMode: options.agentMode,
        risk: tool.risk,
        requiresHumanApproval: tool.requiresHumanApproval
      });

      if (perm.decision === 'deny') {
        toolTrace.push({
          namespacedName: tool.namespacedName,
          serverName: tool.serverName,
          rawToolName: tool.rawToolName,
          args: fc.args ?? {},
          risk: tool.risk,
          decision: 'deny'
        });
        return {
          status: 'blocked_human',
          text: response.text || '',
          activeModel,
          iterations,
          toolTrace
        };
      }

      if (perm.decision === 'require_approval') {
        toolTrace.push({
          namespacedName: tool.namespacedName,
          serverName: tool.serverName,
          rawToolName: tool.rawToolName,
          args: fc.args ?? {},
          risk: tool.risk,
          decision: options.dryRun ? 'dry_run_skipped' : 'require_approval'
        });

        if (options.dryRun) {
          responseParts.push({
            functionResponse: {
              name: tool.namespacedName,
              response: {
                dryRun: true,
                wouldRequireApproval: true,
                tool: tool.namespacedName,
                args: fc.args ?? {}
              }
            }
          });
          continue;
        }

        return {
          status: 'approval_required',
          text: response.text || '',
          activeModel,
          iterations,
          toolTrace,
          pendingApproval: {
            namespacedName: tool.namespacedName,
            serverName: tool.serverName,
            toolName: tool.rawToolName,
            args: fc.args ?? {},
            risk: tool.risk,
            reason: perm.reason
          }
        };
      }

      // Permitted to execute
      const callResult: McpToolCallResult = await options.mcpManager.callTool(
        tool.namespacedName,
        fc.args ?? {},
        { brandId: options.brandId }
      );

      toolTrace.push({
        namespacedName: tool.namespacedName,
        serverName: tool.serverName,
        rawToolName: tool.rawToolName,
        args: fc.args ?? {},
        risk: tool.risk,
        decision: 'execute',
        ok: callResult.ok,
        error: callResult.error,
        durationMs: callResult.durationMs
      });

      responseParts.push({
        functionResponse: {
          name: tool.namespacedName,
          response: callResult.ok
            ? { content: callResult.content }
            : { error: callResult.error ?? 'Tool execution failed' }
        }
      });
    }

    conversation.push({
      role: 'user',
      parts: responseParts
    });
  }

  // Max tool hops reached: synthesize a final response without tools.
  const finalRes = await executeWithModelFallback(
    modelChain,
    (model) =>
      options.gemini.generateContent(conversation, {
        ...options.generateOptions,
        model
      }),
    { preferredModel: preferred, provider: 'gemini', lane: 'interactive' }
  );

  return {
    status: 'completed',
    text: finalRes.result.text,
    activeModel: finalRes.activeModel,
    iterations,
    toolTrace
  };
}
