import { isRecord } from './response-validation';

export interface GeminiGenerateOptions {
  googleSearch?: boolean;
  functionDeclarations?: Array<{name:string;description:string;parameters?:unknown}>;
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  /** WA-012: end-to-end deadline (ms) shared with the provider resilience layer and
   * caller cancellation. Per-request timeout is min(60s, remaining deadline). */
  deadlineMs?: number;
  signal?: AbortSignal;
  thinkingConfig?: {
    thinkingLevel?: 'HIGH' | 'LOW' | 'MEDIUM';
    thinkingBudget?: number;
  };
}

export interface ContentPart {
  text?: string;
  functionCall?: {name:string;args?:Record<string,unknown>};
  functionResponse?: {name:string;response:unknown};
  inlineData?: {
    mimeType: string;
    data: string; // Base64
  };
}

export interface ChatContent {
  role: 'user' | 'model' | 'system';
  parts: ContentPart[];
}

interface GeminiApiCandidatePart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface GeminiApiResponse {
  error?: { message?: string };
  candidates?: Array<{
    content?: { parts?: GeminiApiCandidatePart[] };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

function isCandidatePart(value: unknown): value is GeminiApiCandidatePart {
  if (!isRecord(value) || (value.text !== undefined && typeof value.text !== 'string')) return false;
  const call = value.functionCall;
  return call === undefined || (isRecord(call) && typeof call.name === 'string' &&
    (call.args === undefined || isRecord(call.args)));
}

function isGeminiResponse(value: unknown): value is GeminiApiResponse {
  if (!isRecord(value)) return false;
  const { error, candidates, usageMetadata: usage } = value;
  return (error === undefined || (isRecord(error) && (error.message === undefined || typeof error.message === 'string'))) &&
    (usage === undefined || (isRecord(usage) &&
      (usage.promptTokenCount === undefined || typeof usage.promptTokenCount === 'number') &&
      (usage.candidatesTokenCount === undefined || typeof usage.candidatesTokenCount === 'number'))) &&
    (candidates === undefined || (Array.isArray(candidates) && candidates.every((candidate: unknown) => {
      if (!isRecord(candidate)) return false;
      const { content, groundingMetadata } = candidate;
      if (content !== undefined && (!isRecord(content) ||
          (content.parts !== undefined && (!Array.isArray(content.parts) || !content.parts.every(isCandidatePart))))) {
        return false;
      }
      if (groundingMetadata === undefined) return true;
      if (!isRecord(groundingMetadata)) return false;
      const chunks = groundingMetadata.groundingChunks;
      return chunks === undefined || (Array.isArray(chunks) && chunks.every((chunk: unknown) => {
        if (!isRecord(chunk)) return false;
        const web = chunk.web;
        return web === undefined || (isRecord(web) &&
          (web.uri === undefined || typeof web.uri === 'string') &&
          (web.title === undefined || typeof web.title === 'string'));
      }));
    })));
}

interface ErrorWithStatus extends Error {
  status?: number;
  statusCode?: number;
}

async function readGeminiResponse(response: Response): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  data: GeminiApiResponse | null;
  text: string;
}> {
  const text = await response.text();
  let parsed: GeminiApiResponse | null = null;
  try {
    const value: unknown = JSON.parse(text);
    if (isGeminiResponse(value)) parsed = value;
  } catch {
    parsed = null;
  }
  return { ok: response.ok, status: response.status, statusText: response.statusText, data: parsed, text };
}

export class GeminiClient {
  private apiKey?: string;
  private project?: string;
  private location = 'global';
  private accessToken?: string;
  private tokenExpiresAt = 0;

  constructor(options: { apiKey?: string; project?: string; location?: string } = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.project = options.project || process.env.GOOGLE_CLOUD_PROJECT;
    this.location = options.location || process.env.GOOGLE_CLOUD_LOCATION || 'global';
  }

  /**
   * Lazily fetches or refreshes access token from gcloud CLI
   */
  private async ensureAuth(): Promise<{ type: 'api_key' | 'vertex'; tokenOrKey: string; project?: string }> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt - 60_000) {
      return { type: 'vertex', tokenOrKey: this.accessToken, project: this.project };
    }

    try {
      if (!this.project) {
        const proc = Bun.spawn(['gcloud', 'config', 'get-value', 'project'], {
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 15_000,
          killSignal: 'SIGKILL'
        });
        this.project = (await new Response(proc.stdout).text()).trim() || undefined;
      }

      // Fetch access token via gcloud CLI (active session)
      const tokenProc = Bun.spawn(['gcloud', 'auth', 'print-access-token'], {
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 15_000,
        killSignal: 'SIGKILL'
      });
      const token = (await new Response(tokenProc.stdout).text()).trim();

      if (token && token.length > 20) {
        this.accessToken = token;
        this.tokenExpiresAt = now + 50 * 60 * 1000; // 50 minutes
        return { type: 'vertex', tokenOrKey: this.accessToken, project: this.project };
      }
    } catch {
      // Ignore gcloud error if fallback available
    }

    if (this.apiKey) {
      return { type: 'api_key', tokenOrKey: this.apiKey };
    }

    throw new Error('No valid Gemini authentication found. Please run "gcloud auth login" or set GEMINI_API_KEY.');
  }

  /**
   * Generates content using either Gemini Developer API or Vertex AI
   */
  async generateContent(contents: ChatContent[], options: GeminiGenerateOptions = {}): Promise<{
    text: string;
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
    functionCalls?: Array<{name:string;args:Record<string,unknown>}>;
    usage?: { promptTokens?: number; candidatesTokens?: number };
  }> {
    const auth = await this.ensureAuth();
    const model = options.model ?? 'gemini-4-argon';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-goog-api-client': 'vertex-agent-studio-getcode/1'
    };

    const body: Record<string, unknown> = {
      contents: contents.map((c) => ({
        role: c.role === 'model' ? 'model' : 'user',
        parts: c.parts
      }))
    };

    if (options.googleSearch) body.tools = [{ googleSearch: {} }];
    if (options.functionDeclarations?.length) {
      if (options.googleSearch) throw new Error('Function calling and Search grounding cannot share one tool request');
      body.tools = [{ functionDeclarations: options.functionDeclarations }];
    }

    if (options.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: options.systemInstruction }]
      };
    }

    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = options.maxOutputTokens;
    if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType;
    if (options.responseSchema) generationConfig.responseSchema = options.responseSchema;
    if (options.thinkingConfig) {
      generationConfig.thinkingConfig = {
        thinkingLevel: options.thinkingConfig.thinkingLevel,
        thinkingBudget: options.thinkingConfig.thinkingBudget
      };
      generationConfig.thinking_config = {
        thinking_level: options.thinkingConfig.thinkingLevel,
        thinking_budget: options.thinkingConfig.thinkingBudget
      };
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    const callApi = async (targetModel: string) => {
      let url = '';
      if (auth.type === 'vertex') {
        const host = this.location === 'global' ? 'aiplatform.googleapis.com' : `${this.location}-aiplatform.googleapis.com`;
        url = `https://${host}/v1/projects/${auth.project}/locations/${this.location}/publishers/google/models/${targetModel}:generateContent`;
        headers.Authorization = `Bearer ${auth.tokenOrKey}`;
      } else {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${auth.tokenOrKey}`;
      }

      const timeoutMs = Math.max(1, Math.min(60_000, options.deadlineMs ?? 60_000));
      return fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs)
      });
    };

    let apiResult = await readGeminiResponse(await callApi(model));

    // Fallback gracefully if model not yet enabled or rate limited on Vertex AI endpoint
    if (!apiResult.ok && (apiResult.status === 404 || apiResult.status === 429) && auth.type === 'vertex') {
      let fallbackModel = 'gemini-3.8-flash';
      if (model.includes('carbon')) {
        fallbackModel = 'gemini-4-argon';
      } else if (model.includes('argon') || model.includes('pro')) {
        fallbackModel = 'gemini-3.8-flash';
      } else if (model.includes('hydrogen') || model.includes('neon') || model.includes('flash')) {
        fallbackModel = 'gemini-3.8-flash';
      }
      if (fallbackModel === model) fallbackModel = 'gemini-2.5-flash';
      console.warn(`⚠️ [GeminiClient] Model "${model}" encountered HTTP ${apiResult.status} on Vertex, gracefully falling back to "${fallbackModel}"`);
      apiResult = await readGeminiResponse(await callApi(fallbackModel));
      if (!apiResult.ok && (apiResult.status === 404 || apiResult.status === 429) && fallbackModel !== 'gemini-2.5-flash') {
        console.warn(`⚠️ [GeminiClient] Intermediate fallback "${fallbackModel}" also returned ${apiResult.status}, falling back to "gemini-2.5-flash"`);
        apiResult = await readGeminiResponse(await callApi('gemini-2.5-flash'));
      }
    }
    if (!apiResult.ok) {
      const msg = apiResult.data?.error?.message || (apiResult.text ? apiResult.text.slice(0, 300) : `HTTP ${apiResult.status}: ${apiResult.statusText}`);
      const err: ErrorWithStatus = new Error(`Gemini API Error (${apiResult.status}): ${msg}`);
      err.status = apiResult.status;
      err.statusCode = apiResult.status;
      throw err;
    }

    const data = apiResult.data;
    if (!data) {
      const err: ErrorWithStatus = new Error(`Gemini API returned non-JSON response (${apiResult.status})`);
      err.status = apiResult.status;
      err.statusCode = apiResult.status;
      throw err;
    }

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const textPart = parts.map((part) => part.text ?? '').join('');
    const functionCalls = parts
      .filter((part): part is GeminiApiCandidatePart & { functionCall: { name: string; args?: Record<string, unknown> } } => Boolean(part.functionCall))
      .map((part) => ({ name: part.functionCall.name, args: part.functionCall.args ?? {} }));
    const usage = data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          candidatesTokens: data.usageMetadata.candidatesTokenCount
        }
      : undefined;

    return { text: textPart, usage, groundingMetadata: candidate?.groundingMetadata, functionCalls };
  }
}
