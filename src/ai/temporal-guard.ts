import { isRecord, isStringArray } from './response-validation';

/**
 * NowGuard Temporal Freshness & Real-Time Awareness Guard
 *
 * Adapted from https://github.com/imMamdouhaboammar/nowguard-temporal-freshness (v0.3.0)
 * for WhatsApp conversational AI: provides authoritative clock truth, ordered
 * freshness classification (STATIC / VERSIONED / VOLATILE / LIVE), per-turn
 * TemporalEnvelope prompt injection, EvidenceReceipt validation/merging, and
 * final-answer temporal auditing.
 */

export type FreshnessClass = 'STATIC' | 'VERSIONED' | 'VOLATILE' | 'LIVE';
export type FreshnessMode = 'balanced' | 'strict';
export type EvidenceKind =
  | 'native-live-tool'
  | 'official-documentation'
  | 'official-registry-or-api'
  | 'primary-source'
  | 'secondary-source';

export interface ClockObservation {
  observedAt: string;
  timezone: string;
  local: string;
  isoDate: string;
  dayOfWeek: string;
}

export interface FreshnessClassification {
  freshnessClass: FreshnessClass;
  score: number;
  reasons: string[];
  matchedSignals: string[];
  detectedDomains: string[];
  isHighRisk: boolean;
}

export interface TemporalEnvelope {
  schemaVersion: 1;
  observedAt: string;
  timezone: string;
  localTime: string;
  isoDate: string;
  dayOfWeek: string;
  freshnessClass: FreshnessClass;
  evidenceRequired: boolean;
  expiresAt: string | null;
  reasons: string[];
  matchedSignals: string[];
  detectedDomains: string[];
  isHighRisk: boolean;
  sourceOrder: EvidenceKind[];
  instructions: string[];
}

export interface TemporalAuditResult {
  pass: boolean;
  severity: 'pass' | 'warn' | 'block';
  shouldContinue: boolean;
  reasons: string[];
  currentClaim: boolean;
  evidenceMarker: boolean;
  spoofedEvidence: boolean;
  uncertaintyDisclosed: boolean;
  staleYearDetected: boolean;
  remediation: string | null;
}

export interface EvidenceReceipt {
  schemaVersion: 1;
  kind: EvidenceKind;
  source: string;
  observedAt: string;
  supports: string[];
  expiresAt: string | null;
  metadata: Record<string, unknown>;
}

const DEFAULT_SOURCE_ORDER: EvidenceKind[] = [
  'native-live-tool',
  'official-documentation',
  'official-registry-or-api',
  'primary-source',
  'secondary-source'
];

const CLASS_POLICY: Record<FreshnessClass, { ttlSeconds: number | null; liveEvidenceRequired: boolean }> = {
  STATIC: { ttlSeconds: null, liveEvidenceRequired: false },
  VERSIONED: { ttlSeconds: null, liveEvidenceRequired: false },
  VOLATILE: { ttlSeconds: 86_400, liveEvidenceRequired: true },
  LIVE: { ttlSeconds: 0, liveEvidenceRequired: true }
};

export const systemTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
};

export function clockTruth({
  now = new Date(),
  timezone = 'system'
}: { now?: Date | number; timezone?: string } = {}): ClockObservation {
  const date = now instanceof Date ? now : new Date(now);
  const tz = timezone === 'system' ? systemTimezone() : timezone;
  let local: string;
  let isoDate: string;
  let dayOfWeek: string;

  try {
    local = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset'
    }).format(date);
    isoDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
    dayOfWeek = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long'
    }).format(date);
  } catch {
    const iso = date.toISOString();
    local = iso;
    isoDate = iso.slice(0, 10);
    dayOfWeek = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(date);
  }

  return {
    observedAt: date.toISOString(),
    timezone: tz,
    local,
    isoDate,
    dayOfWeek
  };
}

/**
 * Formats a compact relative age label for message timestamps in conversation history
 * so the agent knows whether a prior message was sent seconds, hours, or days ago.
 */
export function formatRelativeAge(timestampMs: number, nowMs: number = Date.now()): string {
  const diffMs = Math.max(0, nowMs - timestampMs);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// --- Ordered Freshness Classifier (NowGuard v0.3.0 + WhatsApp real-time patterns) ---

const PROVIDED_CONTENT: RegExp[] = [
  /\b(this|the|that|following|above|below|attached|pasted|provided)\s+(document|text|paragraph|essay|sentence|code|snippet|book|chapter|article|passage|file|email|message|content|excerpt|draft)\b/i,
  /\b(pasted|provided|attached|shown|given)\s+(below|above|here|earlier)\b/i,
  /\bthe\s+\w+\s+(?:i|you)\s+(?:pasted|provided|shared|attached|wrote|gave)\b/i,
  /(هذا النص|النص التالي|الفقرة التالية|الملف المرفق|النص المرفق|النص أدناه|المستند التالي|الرسالة دي|الكلام ده)/i
];

const HISTORICAL_RETROSPECTIVE: RegExp[] = [
  /\b(?:in|during|back in|history of|timeline of)\s+(?:19\d\d|200\d|201\d|202[0-3])\b/i,
  /\b(?:who won|what was|who was|which team won)\b.*\b(?:19\d\d|200\d|201\d|202[0-3])\b/i,
  /(في عام|في سنة|خلال عام|تاريخ)\s+(?:19\d\d|200\d|201\d|202[0-3])/i
];

const HARD_LIVE: RegExp[] = [
  /\b(right now|at the moment|at this moment|as of now|as we speak|right this (?:second|minute))\b/i,
  /\b(?:is|are)\b[^?.!]*\b(down|offline|unavailable|having (?:problems|issues|trouble|an outage)|experiencing (?:problems|issues|an outage|degradation|downtime))\b/i,
  /\bproblems?\b[^?.!]*\b(reaching|connecting to|accessing)\b/i,
  /\b(outage|service status|server status|system health|is it down|down right now)\b/i,
  /\bnot (?:loading|working|responding|reachable|connecting|opening)\b[^?.!]*\b(for anyone|anymore|right now|today|for me)?\b/i,
  /\b(?:not (?:loading|working|responding))\b/i,
  /\bfor anyone else\b/i,
  /\b(bring an umbrella|will it rain|is it raining|how (?:hot|cold|warm) is it)\b/i,
  /\b(?:need|bring|wear)\b[^?.!]*\b(umbrella|jacket|coat|sunscreen|raincoat)\b/i,
  /\b(weather|forecast|temperature|rain|snow)\b[^?.!]*\b(today|tonight|tomorrow|now|this (?:morning|afternoon|evening|weekend)|outside)\b/i,
  /\b(stock price|market price|crypto price|exchange rate|market cap)\b/i,
  /\b(sitting at|trading at)\b/i,
  /\bwhere'?s\b[^?.!]*\b(trading|priced|at)\b/i,
  /\b(gold|silver|oil|bitcoin|btc|ethereum|eth)\b[^?.!]*\btrading\b/i,
  /\b(bitcoin|btc|ethereum|eth|tesla|nvidia|apple stock|nasdaq|dow jones|s&p ?500)\b[^?.!]*\b(at|price|market|trading|doing|worth|now|today)\b/i,
  /\b(live score|current champion|currently winning|current standings)\b/i,
  /\bwho'?s (?:top of|leading|winning|ahead)\b/i,
  /\btop of the\b[^?.!]*\b(table|league|standings)\b/i,
  /\bflight\b[^?.!]*\b(on time|delayed|status|arriving|departing|cancelled)\b/i,
  /\b(?:is|are)\b[^?.!]*\b(on time|delayed)\b/i,
  /\b(open|closed)\b[^?.!]*\b(right now|now|at the moment|today|currently)\b/i,
  /\b(what time is it|current time|today'?s date|what day is it)\b/i,
  /\b(in stock|available)\b[^?.!]*\b(right now|now|today|currently)\b/i,
  /\bwhat (?:happened|is happening|'s happening)\b[^?.!]*\b(this week|today|tonight|recently|lately|right now)\b/i,
  /\b(breaking news|latest news|just happened|happening now)\b/i,
  // Arabic present-moment & WhatsApp business live signals
  /(النهارده|دلوقتي|حالاً|حالا|الآن|هذه اللحظة|الساعة كام|تاريخ النهارده|الوقت كام)/i,
  /(هل في مشكلة في السيرفر|السيرفرات واقعة|الموقع واقع|السيرفر واقع|الخدمة متوقفة)/i,
  /(الطقس|درجة الحرارة).*(النهارده|اليوم|بكرة|دلوقتي)/i,
  /(سعر السهم|سعر الصرف|سعر الدولار|البورصة الآن|النتيجة الآن|حالة السيرفر)/i,
  /(فاتحين دلوقتي|شغالين النهارده|مواعيد العمل اليوم|متاح حاليا|موجود دلوقتي)/i
];

const VERSION_TARGET: RegExp[] = [
  /\b(?:react native|react|next(?:\.js)?|node(?:\.js)?|python|typescript|vue|angular|svelte|django|flask|fastapi|laravel|express|bun|deno|tailwind|rails|spring|dotnet|\.net|php|java|kotlin|swift|go(?:lang)?|postgres(?:ql)?|mysql|mariadb|redis|ubuntu|debian|nginx|mongodb|kubernetes|k8s)\s+v?\d+(?:\.\d+){0,3}\b/i,
  /(?:نسخة|إصدار)\s+\d+(?:\.\d+){0,3}/i
];

const VOLATILE_METHOD_DRIFT: RegExp[] = [
  /\b(best practice|best practices)\b/i,
  /\brecommended\b/i,
  /\bshould i (?:still )?(?:use|adopt|pick|choose|reach for|go with|learn)\b/i,
  /\bstill (?:use|be using|using|supported|maintained|available|worth (?:learning|using|it))\b/i,
  /\b(phased out|deprecated|retired|removed from|removed in|dropped|no longer (?:supported|maintained|available)|end of life|end-of-life|\beol\b)\b/i,
  /\b(rate limits?|api limits?|usage limits?|quotas?)\b/i,
  /\b(changed?|updated?|broke(?:n)?|switched)\b[^?.!]*\b(recently|lately|since)\b/i,
  /\brecently\b[^?.!]*\b(changed|updated|deprecated|released|broke)\b/i,
  /\b(these days|nowadays|anymore)\b/i,
  /\bhow much (?:does|do|is|are|would|will)\b[^?.!]*\b(cost|costs|run|charge|charged|price|priced|pay|subscription|plan|seat|license|per month|per year)\b/i,
  /\b(subscription (?:cost|price|fee)|per[- ]seat (?:price|cost)|pricing tier|monthly plan|plan cost)\b/i,
  /(المفروض أستخدم|أنهي إصدار|أي إصدار|يُفضل استخدام|هل ما زال|تم إيقاف|لم يعد مدعوم)/i
];

const CONCEPTUAL_STATIC: RegExp[] = [
  /\bexplain (?:the )?(?:difference|distinction) between\b/i,
  /\bexplain how\b[^?.!]*\b(work|works|assigns?|partitions?|handles?|represents?|computes?|calculates?|operates?)\b/i,
  /\bhow (?:is|are|does|do)\b[^?.!]*\b(work|works|measured|calculated|computed|defined|represented|structured|differ|differs|flow|flows)\b/i,
  /\b(in general terms|under the hood|walk me through|general principle|the concept of|conceptually)\b/i,
  /\b(brief )?history of\b/i,
  /(اشرح الفرق بين|ما هو الفرق بين|بشكل عام|من حيث المبدأ|اشرح كيف)/i
];

const SOFT_LIVE: RegExp[] = [
  /\b(today|tonight|now|currently|current|latest|newest|most recent|up to date|up-to-date)\b/i,
  /\b(who (?:is|'s) (?:the )?(?:current|new)\b)/i,
  /(أحدث|احدث|الحالي|الحالية|آخر إصدار|آخر تحديث|اليوم|آخر أخبار|اخبار)/i
];

const VOLATILE: RegExp[] = [
  /\b(version|versions|release|releases|released|deprecat(?:e|ed|ion|ions)|pricing|price|prices|subscription|plan|cost|costs|law|laws|regulation|regulations|policy|policies|compliance|schedule|officeholder|president|prime minister|ceo|cto|api support|feature availability|stable channel|cve|vulnerabilit(?:y|ies)|security advisory|advisories|exploit|patch|security fix|tax|tax rate|interest rate|inflation|migration|migrate)\b/i,
  /\b(npm|pnpm|yarn|bun|pip|pipx|uv|cargo|go|nuget|gem|composer|package|packages|dependency|dependencies|framework|frameworks|sdk|sdks|api|apis|next\.js|react|vue|angular|svelte|node(?:\.js)?|python|typescript|rust|golang|openai|anthropic|claude|codex|gemini|gpt-?\d|aws|azure|gcp|supabase|vercel|cloudflare|stripe|log4j|moment\.js)\b[^?.!]*\b(install|installation|setup|configure|config|migration|upgrade|update|docs?|documentation|example|integration|support|supports?|recommended|audit|retire|retired|deprecat)\b/i,
  /(إصدار|إصدارات|نسخة|نسخ|تحديث|تحديثات|سعر|أسعار|اشتراك|تكلفة|تكاليف|قانون|قوانين|لائحة|لوائح|سياسة|سياسات|موعد|جدول|متاح|دعم|توثيق|باكدج|باكدجات|مكتبة|مكتبات|حزم|تبعيات|فريمورك|تثبيت|ترقية|إعداد|ثغرة|ثغرات|أمان)/i
];

const STATIC_HINTS: RegExp[] = [
  /\b(translate|rewrite|rephrase|summarize this text|proofread|poem|story|brainstorm|binary search|mathematical proof|algorithm|calculate|solve this equation|regex pattern|regex that)\b/i,
  /(ترجم|أعد صياغة|اعد صياغة|لخص النص|راجع لغوي|اكتب قصة|اكتب قصيدة|اشرح خوارزمية|حل المعادلة)/i
];

const HIGH_RISK_DOMAINS: Array<{ domain: string; pattern: RegExp }> = [
  { domain: 'medical', pattern: /(?:\b(dosage|symptoms?|diagnosis|medication|drug interaction|clinical|treatment|vaccine|prescription)\b|(?:جرعة|أعراض|علاج|دواء|تشخيص|تفاعل دوائي))/i },
  { domain: 'legal', pattern: /(?:\b(gdpr|hipaa|ccpa|compliance|regulation|statute|copyright|trademark|patent|terms of service|privacy policy|lawsuit)\b|(?:قانون|لائحة|امتثال|خصوصية|حقوق الملكية|شروط الخدمة))/i },
  { domain: 'financial', pattern: /(?:\b(stock price|market cap|crypto|bitcoin|btc|ethereum|eth|forex|inflation rate|interest rate|tax rate|deduction|investment advice)\b|(?:سعر السهم|الفائدة|التضخم|الضريبة|استثمار|بورصة))/i },
  { domain: 'security', pattern: /(?:\b(cve|vulnerability|zero-day|exploit|rce|xss|sql injection|auth bypass|secret leak|cve-\d{4}-\d+)\b|(?:ثغرة|اختراق|تسريب|هجوم|أمان))/i },
  { domain: 'dependency-management', pattern: /(?:\b(npm audit|vulnerable package|lockfile|peer dependency|package resolution|breaking change in release)\b|(?:تثبيت مكتبة|تعارض حزم|إصدار مكسور))/i },
  { domain: 'cloud-platform', pattern: /(?:\b(aws iam|gcp service account|azure role|s3 bucket policy|vpc|cloud run egress)\b|(?:سحابة|حساب خدمة|سياسة وصول))/i },
  { domain: 'platform-api', pattern: /(?:\b(oauth 2\.1|api deprecation|rate limit header|webhooks signature|api key rotation)\b|(?:واجهة برمجة التطبيقات|توثيق api|مفتاح api))/i },
  { domain: 'identity-and-auth', pattern: /(?:\b(jwt validation|saml sso|passkeys|webauthn|session revocation|mfa totp)\b|(?:تسجيل الدخول|مصادقة|توثيق الهوية))/i }
];

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function collect(text: string, patterns: RegExp[], label: string): string[] {
  return patterns.filter((p) => p.test(text)).map(() => label);
}

function detectHighRiskDomains(text: string): string[] {
  const domains: string[] = [];
  for (const { domain, pattern } of HIGH_RISK_DOMAINS) {
    if (pattern.test(text)) domains.push(domain);
  }
  return domains;
}

export function classifyFreshness(
  prompt = '',
  { mode = 'balanced' }: { mode?: FreshnessMode } = {}
): FreshnessClassification {
  const MAX_LEN = 4096;
  const raw = prompt || '';
  const text = (raw.length > MAX_LEN ? raw.slice(0, MAX_LEN) : raw).trim();
  if (!text) {
    return {
      freshnessClass: 'STATIC',
      score: 0.55,
      reasons: ['empty-input'],
      matchedSignals: [],
      detectedDomains: [],
      isHighRisk: false
    };
  }

  const detectedDomains = detectHighRiskDomains(text);
  const isHighRisk = detectedDomains.length > 0;
  const riskReason = (): string[] => (isHighRisk ? [`high-risk domain: ${detectedDomains.join(', ')}`] : []);

  const make = (
    freshnessClass: FreshnessClass,
    score: number,
    reasons: string[],
    matchedSignals: string[]
  ): FreshnessClassification => ({
    freshnessClass,
    score,
    reasons,
    matchedSignals,
    detectedDomains,
    isHighRisk
  });

  if (anyMatch(text, PROVIDED_CONTENT)) {
    return make('STATIC', 0.9, ['task operates on content provided in the prompt, not world state', ...riskReason()], ['provided-content-reference']);
  }

  if (anyMatch(text, HISTORICAL_RETROSPECTIVE) && !anyMatch(text, HARD_LIVE)) {
    return make('STATIC', 0.95, ['retrospective historical inquiry with a specific past time anchor', ...riskReason()], ['historical-anchor']);
  }

  const hardLive = collect(text, HARD_LIVE, 'hard-live-signal');
  if (hardLive.length) {
    return make('LIVE', 0.99, ['task depends on present-time world state', ...riskReason()], hardLive);
  }

  const versionHits = collect(text, VERSION_TARGET, 'explicit-version');
  if (versionHits.length) {
    return make('VERSIONED', 0.93, ['task pins an explicit version target', ...riskReason()], versionHits);
  }

  const LATEST_PACKAGE = /\b(latest|newest|most recent|up to date|up-to-date)\b[^?.!]*\b(version|package|packages|release|releases|dependency|dependencies|runner|library|libraries|sdk)\b/i;
  if (LATEST_PACKAGE.test(text)) {
    return make('LIVE', 0.92, ['task wants the newest/current package or version, a present-state fact', ...riskReason()], ['latest-package-signal']);
  }

  const driftHits = collect(text, VOLATILE_METHOD_DRIFT, 'volatile-drift-signal');
  if (driftHits.length) {
    return make('VOLATILE', mode === 'strict' || isHighRisk ? 0.96 : 0.9, ['task asks for guidance/behavior that drifts across releases or policy updates', ...riskReason()], driftHits);
  }

  if (anyMatch(text, CONCEPTUAL_STATIC)) {
    return make('STATIC', 0.9, ['conceptual/educational question answerable without current-world facts', ...riskReason()], ['conceptual-framing']);
  }

  const softLive = collect(text, SOFT_LIVE, 'soft-live-signal');
  if (softLive.length) {
    return make('LIVE', 0.9, ['task references present/most-recent state', ...riskReason()], softLive);
  }

  const volatileHits = collect(text, VOLATILE, 'volatile-signal');
  if (volatileHits.length) {
    return make('VOLATILE', mode === 'strict' || isHighRisk ? 0.98 : 0.9, ['task references information that commonly changes between releases, pricing, or policy updates', ...riskReason()], volatileHits);
  }

  const staticHits = collect(text, STATIC_HINTS, 'static-task');
  if (staticHits.length) {
    return make('STATIC', 0.95, ['task can be completed without current-world facts', ...riskReason()], staticHits);
  }

  if ((mode === 'strict' || isHighRisk) && /\b(code|coding|library|package|api|sdk|framework|dependency|function|module)\b/i.test(text)) {
    return make('VOLATILE', 0.85, [`${mode === 'strict' ? 'strict mode' : 'high-risk domain'} treats unpinned technical behavior as freshness-sensitive`], ['technical-freshness-signal']);
  }

  return make('STATIC', 0.7, ['no material time-sensitive signal detected', ...riskReason()], []);
}

export function buildTemporalEnvelope(
  prompt: string,
  options: { now?: Date | number; timezone?: string; mode?: FreshnessMode } = {}
): TemporalEnvelope {
  const clock = clockTruth({ now: options.now, timezone: options.timezone || 'system' });
  const decision = classifyFreshness(prompt, { mode: options.mode || 'balanced' });
  const cp = CLASS_POLICY[decision.freshnessClass];
  const expiresAt = cp.ttlSeconds !== null
    ? new Date(new Date(clock.observedAt).getTime() + cp.ttlSeconds * 1000).toISOString()
    : null;

  const instructions: string[] = [
    `Treat ${clock.observedAt} (${clock.dayOfWeek}, ${clock.local}, timezone ${clock.timezone}) as the authoritative clock observation for this turn.`,
    `Freshness class: ${decision.freshnessClass}.`
  ];

  if (decision.isHighRisk && decision.detectedDomains.length) {
    instructions.push(`High-risk domain detected (${decision.detectedDomains.join(', ')}). Require strict verification before asserting facts.`);
  }

  if (decision.freshnessClass === 'VERSIONED') {
    instructions.push('Honor the pinned version. If behavior is uncertain, verify against documentation for that exact version rather than silently substituting a newer one.');
  }

  if (cp.liveEvidenceRequired) {
    instructions.push('Before making material time-sensitive factual claims (prices, stock, hours, dates, current events, or versions), verify them with a current tool or grounded source.');
    instructions.push('If current evidence is unavailable, state clearly that live verification was not possible instead of guessing from memory.');
  }

  instructions.push('Check that relative dates ("today", "tomorrow", "النهارده", "بكرة") and conversation history ages are consistent with the authoritative clock.');

  return {
    schemaVersion: 1,
    observedAt: clock.observedAt,
    timezone: clock.timezone,
    localTime: clock.local,
    isoDate: clock.isoDate,
    dayOfWeek: clock.dayOfWeek,
    freshnessClass: decision.freshnessClass,
    evidenceRequired: cp.liveEvidenceRequired,
    expiresAt,
    reasons: decision.reasons,
    matchedSignals: decision.matchedSignals,
    detectedDomains: decision.detectedDomains,
    isHighRisk: decision.isHighRisk,
    sourceOrder: DEFAULT_SOURCE_ORDER,
    instructions
  };
}

export function formatEnvelopeForAgent(envelope: TemporalEnvelope, maxChars = 3500): string {
  const lines = [
    '[NOWGUARD TEMPORAL ENVELOPE]',
    `Clock observed: ${envelope.observedAt}`,
    `Local time: ${envelope.localTime} (${envelope.dayOfWeek})`,
    `Timezone: ${envelope.timezone}`,
    `Freshness: ${envelope.freshnessClass}`,
    `Current evidence required: ${envelope.evidenceRequired ? 'YES' : 'NO'}`,
    `Evidence expires: ${envelope.expiresAt ?? 'not applicable'}`
  ];

  if (envelope.isHighRisk && envelope.detectedDomains.length) {
    lines.push(`High-risk domain: ${envelope.detectedDomains.join(', ')}`);
  }

  lines.push(
    ...envelope.instructions.map((x, i) => `${i + 1}. ${x}`),
    '[END NOWGUARD]'
  );

  return lines.join('\n').slice(0, maxChars);
}

// --- Final-Answer Temporal Audit Gate ---

const CURRENT_CLAIM: RegExp[] = [
  /\b(current|currently|latest|newest|most recent|today|now|as of|available now|is available|supports|no longer supports|deprecated|price is|costs|president is|ceo is|stock is at|score is|weather is)\b/i,
  /\bthe (?:latest|newest|current|most recent)\b/i,
  /\b(?:is|are|remains?)\b[^.!?]*\b(the current|the latest|now available|still supported|no longer available)\b/i,
  /(حاليا|حالياً|النهارده|اليوم|أحدث|احدث|آخر إصدار|متاح الآن|متاح حاليا|السعر|الرئيس الحالي|المدير التنفيذي الحالي|حالة الطقس الآن)/i
];

// A URL is only a citation marker, not proof that the source was fetched.
const hasSourceUrl = (text: string): boolean => {
  for (const [candidate] of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const trimmed = candidate.replace(/[),.;!?\]}]+$/, '');
    if (!URL.canParse(trimmed)) continue;
    const url = new URL(trimmed);
    if (url.username || url.password) continue;
    const hostname = url.hostname.replace(/\.$/, '');
    const labels = hostname.split('.');
    const tld = labels.at(-1) ?? '';
    if (hostname.length <= 253 && labels.length >= 2 && /^[a-z]{2,63}$/i.test(tld)
      && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
      return true;
    }
  }
  return false;
};

const NAMED_SOURCE: RegExp[] = [
  /\b(official docs|official documentation|release notes|changelog|github release|npm registry|pypi package|the registry|manufacturer'?s? site|primary source|per the docs at)\b/i,
  /\bas of \d{4}(?:-\d{2}-\d{2})?\b/i,
  /\b(verified (?:via|against)|checked (?:via|against|on))\b[^.!?]*\b(docs?|documentation|registry|source|https?:\/\/|official)\b/i,
  /(التوثيق الرسمي|سجل التغييرات|بحسب .* الرسمي|تم التحقق (?:من|عبر))/i
];

const SPOOF_ONLY_MARKER: RegExp[] = [
  /^[^a-zA-Z0-9]*\[\^?\d+\][^a-zA-Z0-9]*$/,
  /\[cite\]/i
];

const WEAK_MARKER: RegExp[] = [
  /\[\^?\d+\]/,
  /\[cite/i,
  /\b(source|sources|documentation|registry)\b/i,
  /(المصدر|المصادر|التوثيق)/i
];

const UNCERTAINTY_DISCLOSURE: RegExp[] = [
  /\b(cannot verify|could not be verified|unable to verify|live verification was not possible|knowledge cutoff|as of my last update|as of my (?:training|knowledge)|live data unavailable|subject to change|may (?:have|be) (?:changed|outdated)|please (?:double-?check|verify)|verify (?:this|independently|against)|check with the store|confirm with)\b/i,
  /(لم أتمكن من التحقق|مش قادر أتأكد|محتاج أتأكد|غير متاح للتحقق المباشر|لا يمكن الجزم|قد يطرأ تغيير|وفق آخر تحديث محفوظ|يرجى التأكد|قد تكون قديمة|هتأكد مع|نراجع الأول)/i
];

const TRAINING_ERA_STALENESS: RegExp[] = [
  /\bas of my (?:training|knowledge|last update)\b/i,
  /\b(?:in|as of) my training data\b/i,
  /(?:وفق|حسب) (?:بيانات )?تدريبي/i
];

function assessEvidence(text: string): { evidenceMarker: boolean; spoofed: boolean } {
  const hasRealUrl = hasSourceUrl(text);
  const hasNamedSource = anyMatch(text, NAMED_SOURCE);
  const trimmed = (text || '').trim();
  const onlySpoof = anyMatch(trimmed, SPOOF_ONLY_MARKER);
  const hasWeak = anyMatch(text, WEAK_MARKER);

  if (hasRealUrl || hasNamedSource) {
    return { evidenceMarker: true, spoofed: false };
  }
  if (onlySpoof || hasWeak) {
    return { evidenceMarker: false, spoofed: true };
  }
  return { evidenceMarker: false, spoofed: false };
}

function detectStaleYearAssertion(text: string, currentYear: number | null): { assertedYear: number; currentYear: number } | null {
  if (!currentYear) return null;
  const stalePattern = /\b(?:in the current year|currently in|as of current year|this year(?:,|\s+is)?|the year is(?:\s+now)?)\s+(20[0-2][0-9])\b/i;
  const match = text.match(stalePattern);
  if (match?.[1]) {
    const assertedYear = Number.parseInt(match[1], 10);
    if (assertedYear < currentYear) {
      return { assertedYear, currentYear };
    }
  }
  return null;
}

export function auditTemporalAnswer(
  answer = '',
  envelope: Partial<TemporalEnvelope> = {},
  { stopHookActive = false, hasVerifiedEvidence = false }: { stopHookActive?: boolean; hasVerifiedEvidence?: boolean } = {}
): TemporalAuditResult {
  const MAX_LEN = 16_384;
  const raw = answer || '';
  const text = raw.length > MAX_LEN ? raw.slice(0, MAX_LEN) : raw;

  const currentClaim = anyMatch(text, CURRENT_CLAIM);
  const assessed = assessEvidence(text);
  const evidenceMarker = assessed.evidenceMarker || hasVerifiedEvidence;
  const spoofed = hasVerifiedEvidence ? false : assessed.spoofed;
  const uncertaintyDisclosed = anyMatch(text, UNCERTAINTY_DISCLOSURE);
  const trainingEraStale = anyMatch(text, TRAINING_ERA_STALENESS);
  const highFreshness = envelope.freshnessClass === 'LIVE' || envelope.freshnessClass === 'VOLATILE';

  let currentYear: number | null = null;
  if (envelope.observedAt) {
    const d = new Date(envelope.observedAt);
    if (!Number.isNaN(d.getTime())) currentYear = d.getUTCFullYear();
  }

  const staleYear = detectStaleYearAssertion(text, currentYear);
  let shouldContinue = false;
  let severity: 'pass' | 'warn' | 'block' = 'pass';
  const reasons: string[] = [];
  let remediation: string | null = null;

  if (staleYear) {
    severity = 'block';
    reasons.push(`asserts ${staleYear.assertedYear} as the current year, but authoritative clock year is ${staleYear.currentYear}`);
    shouldContinue = !stopHookActive;
    remediation = `Update time references to reflect the current year (${staleYear.currentYear}) and verify any time-dependent statements against present evidence.`;
  } else if (highFreshness && envelope.evidenceRequired && currentClaim && spoofed && !uncertaintyDisclosed) {
    severity = envelope.freshnessClass === 'LIVE' ? 'block' : 'warn';
    shouldContinue = envelope.freshnessClass === 'LIVE' && !stopHookActive;
    reasons.push('answer presents a citation-like marker that does not resolve to a real source (spoofed evidence)');
    remediation = 'Cite a resolvable first-party source (URL, registry, or official docs) or explicitly state that live verification was unavailable.';
  } else if (highFreshness && envelope.evidenceRequired && currentClaim && !evidenceMarker && !uncertaintyDisclosed) {
    severity = envelope.freshnessClass === 'LIVE' ? 'block' : 'warn';
    shouldContinue = envelope.freshnessClass === 'LIVE' && !stopHookActive;
    reasons.push('freshness-sensitive answer contains a current-state claim without an observable evidence marker or uncertainty disclosure');
    remediation = 'Verify the material current claims using an appropriate live tool, registry, or official documentation, or explicitly state that live verification was unavailable.';
  } else if (highFreshness && envelope.evidenceRequired && trainingEraStale && !evidenceMarker) {
    severity = 'pass';
    reasons.push('answer discloses reliance on training-era knowledge rather than asserting unverified current state');
  } else if (uncertaintyDisclosed && !evidenceMarker) {
    severity = 'pass';
    reasons.push('properly disclosed that live state could not be verified');
  }

  return {
    pass: reasons.length === 0 || ((uncertaintyDisclosed || trainingEraStale) && !staleYear && severity === 'pass'),
    severity,
    shouldContinue,
    reasons,
    currentClaim,
    evidenceMarker,
    spoofedEvidence: spoofed,
    uncertaintyDisclosed,
    staleYearDetected: Boolean(staleYear),
    remediation
  };
}

// --- Evidence Receipts & TTL Merging ---

const VALID_KINDS = new Set<EvidenceKind>(DEFAULT_SOURCE_ORDER);

export function createEvidenceReceipt({
  kind = 'primary-source',
  source,
  supports,
  observedAt,
  expiresAt = null,
  metadata = {}
}: {
  kind?: EvidenceKind;
  source: string;
  supports: string[];
  observedAt?: string | number | Date;
  expiresAt?: string | number | Date | null;
  metadata?: Record<string, unknown>;
}): EvidenceReceipt {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`Invalid evidence kind "${kind}"`);
  }
  if (!source || typeof source !== 'string' || !source.trim()) {
    throw new Error('Evidence source must be a non-empty string.');
  }
  if (!Array.isArray(supports) || supports.length === 0) {
    throw new Error('Evidence supports must be a non-empty array of supported claim strings.');
  }

  const obs = observedAt ? new Date(observedAt).toISOString() : clockTruth().observedAt;
  const exp = expiresAt ? new Date(expiresAt).toISOString() : null;

  return {
    schemaVersion: 1,
    kind,
    source: source.trim(),
    observedAt: obs,
    supports: supports.map((s) => s.trim()).filter(Boolean),
    expiresAt: exp,
    metadata
  };
}

function parseEvidenceReceipt(value: unknown): { receipt: EvidenceReceipt } | { errors: string[] } {
  if (!isRecord(value)) return { errors: ['Receipt must be an object'] };
  const { schemaVersion, source, observedAt, supports, expiresAt, metadata } = value;
  const kind = DEFAULT_SOURCE_ORDER.find((candidate) => candidate === value.kind);
  const errors: string[] = [];
  if (schemaVersion !== 1) errors.push('Invalid schema version');
  if (kind === undefined) errors.push('Invalid or missing kind');
  if (typeof source !== 'string' || !source.trim()) errors.push('Missing source');
  if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) errors.push('Invalid observedAt date format');
  if (!isStringArray(supports) || supports.length === 0) errors.push('supports must be a non-empty array of strings');
  if (expiresAt !== null && (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt)))) {
    errors.push('Invalid expiresAt date format');
  }
  if (!isRecord(metadata)) errors.push('Invalid metadata');
  if (errors.length || schemaVersion !== 1 || kind === undefined || typeof source !== 'string' ||
      typeof observedAt !== 'string' || !isStringArray(supports) ||
      (expiresAt !== null && typeof expiresAt !== 'string') || !isRecord(metadata)) return { errors };
  return { receipt: { schemaVersion, kind, source, observedAt, supports, expiresAt, metadata } };
}

export function validateEvidenceReceipt(value: unknown): { valid: boolean; errors: string[] } {
  const result = parseEvidenceReceipt(value);
  return 'errors' in result ? { valid: false, errors: result.errors } : { valid: true, errors: [] };
}

export function isEvidenceExpired(receipt: Pick<EvidenceReceipt, 'expiresAt'> | null | undefined, atTime: Date | number = Date.now()): boolean {
  if (!receipt || !receipt.expiresAt) return false;
  const expiry = new Date(receipt.expiresAt).getTime();
  const check = typeof atTime === 'number' ? atTime : atTime.getTime();
  return check >= expiry;
}

export function mergeEvidenceReceipts(
  receipts: unknown[],
  { now = Date.now(), filterExpired = true }: { now?: Date | number; filterExpired?: boolean } = {}
): {
  validReceipts: EvidenceReceipt[];
  expiredReceipts: EvidenceReceipt[];
  invalidReceipts: Array<{ receipt: unknown; errors: string[] }>;
} {
  const validReceipts: EvidenceReceipt[] = [];
  const expiredReceipts: EvidenceReceipt[] = [];
  const invalidReceipts: Array<{ receipt: unknown; errors: string[] }> = [];
  const seen = new Set<string>();

  for (const raw of receipts) {
    const val = parseEvidenceReceipt(raw);
    if ('errors' in val) {
      invalidReceipts.push({ receipt: raw, errors: val.errors });
      continue;
    }
    const { receipt } = val;
    if (filterExpired && isEvidenceExpired(receipt, now)) {
      expiredReceipts.push(receipt);
      continue;
    }
    const dedupKey = `${receipt.kind}::${receipt.source}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    validReceipts.push(receipt);
  }

  validReceipts.sort((a, b) => DEFAULT_SOURCE_ORDER.indexOf(a.kind) - DEFAULT_SOURCE_ORDER.indexOf(b.kind));

  return { validReceipts, expiredReceipts, invalidReceipts };
}

/**
 * Gemini middleware adapter matching NowGuard's createGeminiTemporalGuard contract.
 */
export function createGeminiTemporalGuard(options: { timezone?: string; mode?: FreshnessMode; now?: () => number } = {}) {
  return {
    beforeGenerateContent({
      prompt = '',
      systemInstruction = '',
      contents = []
    }: { prompt?: string; systemInstruction?: string; contents?: unknown[] } = {}) {
      const envelope = buildTemporalEnvelope(prompt, {
        now: options.now ? options.now() : undefined,
        timezone: options.timezone,
        mode: options.mode
      });
      const temporalInstruction = formatEnvelopeForAgent(envelope);
      const mergedInstruction = systemInstruction
        ? `${systemInstruction}\n\n${temporalInstruction}`
        : temporalInstruction;

      return {
        envelope,
        systemInstruction: mergedInstruction,
        contents
      };
    },

    afterGenerateContent({
      text = '',
      envelope,
      hasVerifiedEvidence = false
    }: { text?: string; envelope?: Partial<TemporalEnvelope>; hasVerifiedEvidence?: boolean }) {
      return auditTemporalAnswer(text, envelope || {}, { hasVerifiedEvidence });
    }
  };
}
