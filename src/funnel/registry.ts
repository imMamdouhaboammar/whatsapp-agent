import type { FunnelMethodConfig, FunnelTarget } from './types';

export interface FunnelRegistryOptions {
  apiKeys?: string[];
  initialMethods?: FunnelMethodConfig[];
}

export class FunnelRegistry {
  private readonly methods = new Map<string, FunnelMethodConfig>();
  private readonly apiKeys = new Set<string>();

  constructor(options: FunnelRegistryOptions = {}) {
    if (options.apiKeys) {
      for (const key of options.apiKeys) {
        if (key && key.trim()) {
          this.apiKeys.add(key.trim());
        }
      }
    }

    // Default API keys from environment if set
    const envKey = process.env.FUNNEL_API_KEY || process.env.AGENT_CAPABILITY_TOKEN;
    if (envKey) {
      this.apiKeys.add(envKey.trim());
    }

    if (options.initialMethods) {
      for (const m of options.initialMethods) {
        this.registerMethod(m);
      }
    }
  }

  registerMethod(config: FunnelMethodConfig): void {
    if (!config.method || !config.method.trim()) {
      throw new Error('Method name is required');
    }
    this.methods.set(config.method.trim(), {
      ...config,
      method: config.method.trim()
    });
  }

  unregisterMethod(methodName: string): boolean {
    return this.methods.delete(methodName.trim());
  }

  getMethod(methodName: string): FunnelMethodConfig | undefined {
    return this.methods.get(methodName.trim());
  }

  listMethods(): FunnelMethodConfig[] {
    return Array.from(this.methods.values());
  }

  getActiveTargets(methodName: string): FunnelTarget[] {
    const config = this.getMethod(methodName);
    if (!config) return [];
    return config.targets.filter((t) => t.enabled !== false);
  }

  addApiKey(key: string): void {
    if (key && key.trim()) {
      this.apiKeys.add(key.trim());
    }
  }

  validateKey(key?: string): boolean {
    if (!key || typeof key !== 'string') return false;
    if (this.apiKeys.size === 0) return false;
    return this.apiKeys.has(key.trim());
  }
}
