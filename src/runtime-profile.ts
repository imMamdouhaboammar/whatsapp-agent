/**
 * WA-023: explicit runtime profiles. FULL preserves the current eager behavior and stays
 * the default; CORE_MINIMAL is an opt-in lean profile (Bun, SQLite, static UI, Gemini,
 * the selected transport) that lazily creates nothing it does not need: no reflection
 * sweep timers, no funnel engine, no voice synthesis, no proactive scheduler, and never
 * a Baileys wrapper when the Meta transport is selected.
 */

import { transportCapabilities } from './transport/capabilities';

export type RuntimeProfileName = 'CORE_MINIMAL' | 'FULL';
export type TransportMode = 'baileys' | 'meta-cloud';

export interface RuntimeProfileConfig {
  readonly name: RuntimeProfileName;
  readonly reflectionEnabled: boolean;
  readonly funnelEnabled: boolean;
  readonly voiceEnabled: boolean;
  readonly proactiveEnabled: boolean;
  baileysWrapperEnabled(transport: TransportMode): boolean;
}

const DEFS: Record<RuntimeProfileName, Omit<RuntimeProfileConfig, 'name' | 'baileysWrapperEnabled'>> = {
  FULL: { reflectionEnabled: true, funnelEnabled: true, voiceEnabled: true, proactiveEnabled: true },
  CORE_MINIMAL: { reflectionEnabled: false, funnelEnabled: false, voiceEnabled: false, proactiveEnabled: false }
};

export function resolveRuntimeProfile(input?: string): RuntimeProfileConfig {
  const raw = (input ?? process.env.AGENT_RUNTIME_PROFILE ?? 'FULL').trim().toUpperCase();
  if (raw !== 'FULL' && raw !== 'CORE_MINIMAL') {
    throw new Error(`Unsupported runtime profile "${raw}". Expected FULL or CORE_MINIMAL.`);
  }
  const name: RuntimeProfileName = raw;
  return {
    name,
    ...DEFS[name],
    // The Baileys wrapper exists only for the Baileys transport, in every profile:
    // meta-cloud mode must never pay for a second transport wrapper.
    baileysWrapperEnabled: (transport: TransportMode) => transport === 'baileys'
  };
}

export interface CapabilityRow {
  capability: string;
  enabled: boolean;
  reason: string;
}

export function capabilityMatrix(profile: RuntimeProfileConfig, transport: TransportMode): CapabilityRow[] {
  return [
    {
      capability: 'transport:baileys',
      enabled: profile.baileysWrapperEnabled(transport),
      reason: profile.baileysWrapperEnabled(transport)
        ? 'selected transport'
        : 'meta-cloud transport selected; Baileys wrapper not constructed'
    },
    {
      capability: 'transport:meta-cloud',
      enabled: transport === 'meta-cloud',
      reason: transport === 'meta-cloud' ? 'selected transport' : 'baileys transport selected'
    },
    {
      capability: 'reflection',
      enabled: profile.reflectionEnabled,
      reason: profile.reflectionEnabled ? 'enabled by profile' : `disabled in ${profile.name} profile`
    },
    {
      capability: 'funnel',
      enabled: profile.funnelEnabled,
      reason: profile.funnelEnabled ? 'enabled by profile' : `disabled in ${profile.name} profile`
    },
    {
      capability: 'voice',
      enabled: profile.voiceEnabled,
      reason: profile.voiceEnabled ? 'enabled by profile' : `disabled in ${profile.name} profile`
    },
    {
      capability: 'proactive',
      enabled: profile.proactiveEnabled,
      reason: profile.proactiveEnabled ? 'enabled by profile' : `disabled in ${profile.name} profile`
    },
    // WA-024: per-transport feature rows so the UI and operators never assume
    // feature parity the active transport does not have.
    ...transportCapabilities(transport).map((row) => ({
      capability: `feature:${row.feature}`,
      enabled: row.supported,
      reason: row.reason
    }))
  ];
}
