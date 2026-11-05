export interface GeminiGenerateOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: any;
}

export interface ContentPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // Base64
  };
}

export interface ChatContent {
  role: 'user' | 'model' | 'system';
  parts: ContentPart[];
}

export class GeminiClient {
  private apiKey?: string;
  private project?: string;
  private location = 'us-central1';
  private accessToken?: string;
  private tokenExpiresAt = 0;
  private preferVertex = false;

  constructor(options: { apiKey?: string; project?: string; location?: string } = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.project = options.project || process.env.GOOGLE_CLOUD_PROJECT;
    if (options.location) this.location = options.location;
  }

  /**
   * Lazily fetches or refreshes access token from gcloud CLI if no API key is specified
   */
  private async ensureAuth(): Promise<{ type: 'api_key' | 'vertex'; tokenOrKey: string; project?: string }> {
    if (this.apiKey) {
      return { type: 'api_key', tokenOrKey: this.apiKey };
    }

    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt - 60_000) {
      return { type: 'vertex', tokenOrKey: this.accessToken, project: this.project };
    }

    try {
      // Resolve project if not specified
      if (!this.project) {
        const proc = Bun.spawn(['gcloud', 'config', 'get-value', 'project'], { stdout: 'pipe' });
        this.project = (await new Response(proc.stdout).text()).trim();
      }

      // Fetch access token via gcloud
      const tokenProc = Bun.spawn(['gcloud', 'auth', 'print-access-token'], { stdout: 'pipe' });
      const token = (await new Response(tokenProc.stdout).text()).trim();

      if (token && token.length > 20) {
        this.accessToken = token;
        this.tokenExpiresAt = now + 50 * 60 * 1000; // 50 minutes
        this.preferVertex = true;
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
    usage?: { promptTokens?: number; candidatesTokens?: number };
  }> {
    const auth = await this.ensureAuth();
    const model = options.model ?? 'gemini-2.5-flash';

    let endpoint = '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (auth.type === 'vertex') {
      endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${auth.project}/locations/${this.location}/publishers/google/models/${model}:generateContent`;
      headers.Authorization = `Bearer ${auth.tokenOrKey}`;
    } else {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${auth.tokenOrKey}`;
    }

    const body: any = {
      contents: contents.map((c) => ({
        role: c.role === 'model' ? 'model' : 'user',
        parts: c.parts
      }))
    };

    if (options.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: options.systemInstruction }]
      };
    }

    const generationConfig: any = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = options.maxOutputTokens;
    if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType;
    if (options.responseSchema) generationConfig.responseSchema = options.responseSchema;

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const data: any = await res.json();
    if (!res.ok) {
      const msg = data.error?.message || `HTTP ${res.status}: ${res.statusText}`;
      throw new Error(`Gemini API Error: ${msg}`);
    }

    const candidate = data.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text ?? '';
    const usage = data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          candidatesTokens: data.usageMetadata.candidatesTokenCount
        }
      : undefined;

    return { text: textPart, usage };
  }
}
