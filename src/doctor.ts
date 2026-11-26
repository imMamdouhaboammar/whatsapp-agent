export type CheckLevel = 'pass' | 'warn' | 'fail';
export interface DoctorCheck {
  id: string;
  section: 'preflight' | 'live';
  level: CheckLevel;
  label: string;
  detail?: string;
}

export interface DoctorProbes {
  bunVersion: string;
  env: Record<string, string | undefined>;
  /** Opens the local chat store; throws when unusable. Returns the indexed chat count. */
  openStorage: () => number;
  /** True when the web cockpit build exists. */
  uiBuilt: () => boolean;
  /** Resolves true when the active gcloud account can mint a token and a project is set. Rejects with the cause otherwise. */
  gcloudAuthenticated: () => Promise<boolean>;
  /** True when a paired Baileys session is saved. */
  sessionPaired: () => boolean;
  /** Verifies SQLite writeability and commit capability; false means the write did not commit. */
  testStorageWrite?: () => boolean;
  /** Verifies Baileys connection validator patch is applied */
  baileysPatched?: () => boolean;
  /** WA-011: verifies a configured GEMINI_API_KEY against the model API; false means rejected. */
  verifyModelKey?: () => Promise<boolean>;
  /** Optional external MCP client health check (returns empty array when unconfigured). */
  checkExternalMcp?: () => Promise<Array<{ name: string; status: string; toolCount: number; lastError?: string }>>;
}

/**
 * WA-011: both patch targets must be present — the passive flag alone passes
 * even when the lidDbMigrated removal never landed.
 */
export function verifyBaileysPatch(validatorSource: string): boolean {
  const passivePatched = /passive:\s*false,\s*pull:\s*true,/.test(validatorSource);
  const lidRemoved = /\/\*\s*lidDbMigrated removed\s*\*\//.test(validatorSource);
  const lidStillPresent = /lidDbMigrated:\s*false/.test(validatorSource);
  return passivePatched && lidRemoved && !lidStillPresent;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  failures: number;
  warnings: number;
  preflightOk: boolean;
  liveReady: boolean;
  exitCode: 0 | 1;
}

const MIN_BUN: [number, number] = [1, 3];
const META_VARS = [
  'META_CLOUD_GRAPH_VERSION', 'META_CLOUD_PHONE_NUMBER_ID', 'META_CLOUD_BUSINESS_ACCOUNT_ID',
  'META_CLOUD_ACCESS_TOKEN', 'META_CLOUD_APP_SECRET', 'META_CLOUD_VERIFY_TOKEN',
  // createFableWhatsAppAgent throws at startup in meta-cloud mode without it.
  'AGENT_AUTOPILOT_BRAND_ID'
];

/** Environment text is printed to an operator terminal: drop control characters and cap length. */
function printable(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 64);
}

function bunAtLeast(version: string): boolean {
  const [major, minor] = version.split('.').map((n) => Number.parseInt(n, 10));
  return Number.isFinite(major) && (major > MIN_BUN[0] || (major === MIN_BUN[0] && (minor ?? 0) >= MIN_BUN[1]));
}

/**
 * Install preflight (is this checkout runnable) is separate from live readiness (can it
 * actually answer customers now). Any failed check makes the exit code 1. Warnings do not,
 * unless `strict` is set.
 */
export async function runDoctor(probes: DoctorProbes, options: { preflightOnly?: boolean; strict?: boolean } = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (c: DoctorCheck) => checks.push(c);

  add(bunAtLeast(probes.bunVersion)
    ? { id: 'bun', section: 'preflight', level: 'pass', label: `Bun ${probes.bunVersion}` }
    : { id: 'bun', section: 'preflight', level: 'fail', label: `Bun ${probes.bunVersion} is older than ${MIN_BUN.join('.')}` });

  try {
    const chats = probes.openStorage();
    add({ id: 'storage', section: 'preflight', level: 'pass', label: `Local storage opens (${chats} chats indexed)` });
    if (probes.testStorageWrite) {
      // WA-011: a probe that returns false means the write did not commit.
      const writable = probes.testStorageWrite() === true;
      add(writable
        ? { id: 'storage-write', section: 'preflight', level: 'pass', label: 'Local storage is writable (WAL commit verified)' }
        : { id: 'storage-write', section: 'preflight', level: 'fail', label: 'Local storage write probe did not commit', detail: 'The write transaction returned false.' });
    }
  } catch (err) {
    add({ id: 'storage', section: 'preflight', level: 'fail', label: 'Local storage error', detail: err instanceof Error ? err.message : String(err) });
  }

  if (probes.baileysPatched) {
    const patched = probes.baileysPatched();
    add(patched
      ? { id: 'baileys-patch', section: 'preflight', level: 'pass', label: 'Baileys protocol patch verified' }
      : { id: 'baileys-patch', section: 'preflight', level: 'fail', label: 'Baileys protocol patch missing', detail: 'Run `bun patch-baileys.mjs`.' });
  }

  add(probes.uiBuilt()
    ? { id: 'ui', section: 'preflight', level: 'pass', label: 'Web cockpit build found (ui/dist)' }
    : { id: 'ui', section: 'preflight', level: 'warn', label: 'Web cockpit not built', detail: 'Run `bun run build` to serve the dashboard.' });

  if (!options.preflightOnly) {
    const hasKey = Boolean(probes.env.GEMINI_API_KEY);
    if (hasKey && probes.verifyModelKey) {
      // WA-011: key presence is not validity — verify against the model API.
      let keyValid = false;
      let keyError = '';
      try {
        keyValid = await probes.verifyModelKey();
      } catch (err) {
        keyError = printable(err instanceof Error ? err.message : String(err));
      }
      add(keyValid
        ? { id: 'model-auth', section: 'live', level: 'pass', label: 'Gemini API key verified with the model API' }
        : { id: 'model-auth', section: 'live', level: 'fail', label: 'GEMINI_API_KEY was rejected by the model API', detail: `The configured key did not authenticate.${keyError ? ` Verification error: ${keyError}` : ''}` });
    } else {
    let gcloudOk = false;
    let gcloudError = '';
    if (!hasKey) {
      try { gcloudOk = await probes.gcloudAuthenticated(); } catch (err) {
        gcloudError = printable(err instanceof Error ? err.message : String(err));
      }
    }
    add(hasKey || gcloudOk
      ? { id: 'model-auth', section: 'live', level: 'pass', label: hasKey ? 'Gemini API key configured' : 'gcloud account and project available' }
      : { id: 'model-auth', section: 'live', level: 'fail', label: 'No model credentials', detail: `Set GEMINI_API_KEY, or run \`gcloud auth login\` and \`gcloud config set project <id>\` (the app uses the active gcloud account and project).${gcloudError ? ` gcloud said: ${gcloudError}` : ''}` });
    }

    const transport = probes.env.WHATSAPP_TRANSPORT ?? 'baileys';
    if (transport === 'meta-cloud') {
      const missing = META_VARS.filter((name) => !probes.env[name]);
      add(missing.length === 0
        ? { id: 'transport', section: 'live', level: 'pass', label: 'Meta Cloud API variables are all set (not verified against Meta)' }
        : { id: 'transport', section: 'live', level: 'fail', label: 'Meta Cloud API is partially configured', detail: `Missing: ${missing.join(', ')}` });
    } else if (transport === 'baileys') {
      add(probes.sessionPaired()
        ? { id: 'transport', section: 'live', level: 'pass', label: 'Baileys session saved (connection not tested)' }
        : { id: 'transport', section: 'live', level: 'fail', label: 'No paired WhatsApp session', detail: 'Run `bun run cli pair`.' });
    } else {
      add({ id: 'transport', section: 'live', level: 'fail', label: `Unknown WHATSAPP_TRANSPORT "${printable(transport)}"`, detail: 'Use baileys or meta-cloud.' });
    }

    const token = probes.env.AGENT_DASHBOARD_TOKEN ?? '';
    const host = probes.env.HOST || '127.0.0.1'; // same fallback as server startup
    const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.toLowerCase());
    if (!loopback && token.length < 24) {
      add({ id: 'dashboard-auth', section: 'live', level: 'fail', label: 'Non-loopback HOST without a strong AGENT_DASHBOARD_TOKEN', detail: 'Use a random token of at least 24 characters, for example `openssl rand -hex 32`.' });
    }

    if (probes.checkExternalMcp) {
      try {
        const servers = await probes.checkExternalMcp();
        for (const srv of servers) {
          if (srv.status === 'disabled') continue;
          if (srv.status === 'connected') {
            add({ id: `mcp-${srv.name}`, section: 'live', level: 'pass', label: `External MCP '${srv.name}' connected (${srv.toolCount} tools)` });
          } else {
            add({ id: `mcp-${srv.name}`, section: 'live', level: 'warn', label: `External MCP '${srv.name}' unavailable (${srv.status})`, detail: srv.lastError });
          }
        }
      } catch (err) {
        add({ id: 'mcp-external', section: 'live', level: 'warn', label: 'External MCP check failed', detail: printable(err instanceof Error ? err.message : String(err)) });
      }
    }
  }

  const failures = checks.filter((c) => c.level === 'fail').length;
  const warnings = checks.filter((c) => c.level === 'warn').length;
  const preflightOk = !checks.some((c) => c.section === 'preflight' && c.level === 'fail');
  const exitCode = failures > 0 || (options.strict === true && warnings > 0) ? 1 : 0;
  const liveReady = !options.preflightOnly && exitCode === 0;
  return { checks, failures, warnings, preflightOk, liveReady, exitCode };
}

export function formatDoctorReport(report: DoctorReport, options: { preflightOnly?: boolean } = {}): string {
  const icon = { pass: '✓', warn: '⚠', fail: '✗' } as const;
  const lines: string[] = [];
  for (const section of ['preflight', 'live'] as const) {
    const rows = report.checks.filter((c) => c.section === section);
    if (rows.length === 0) continue;
    lines.push(section === 'preflight' ? 'Install preflight' : 'Live readiness');
    for (const c of rows) {
      lines.push(`  ${icon[c.level]} ${c.label}`);
      if (c.detail) lines.push(`    ${c.detail}`);
    }
  }
  lines.push('');
  if (report.failures > 0) {
    lines.push(`NOT READY: ${report.failures} check(s) failed${report.warnings ? `, ${report.warnings} warning(s)` : ''}.`);
  } else if (report.exitCode !== 0) {
    lines.push(`NOT READY (--strict): ${report.warnings} warning(s) treated as failures.`);
  } else if (options.preflightOnly) {
    lines.push('Preflight passed. Live readiness was not checked (run `doctor` without --preflight).');
  } else {
    lines.push(`Ready to start${report.warnings ? ` (${report.warnings} warning(s))` : ''}. Credentials and connection are configured, not proven live: start the app and watch the status.`);
  }
  return lines.join('\n');
}
