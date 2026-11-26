/**
 * WA-024: explicit transport capability contract. Each transport declares the
 * features it genuinely supports; unsupported features must be surfaced to
 * operators and UI, never silently claimed or faked.
 */
export type TransportFeature =
  | 'text'
  | 'rich-media'
  | 'receipts'
  | 'templates'
  | 'reactions'
  | 'voice-notes'
  | 'inbound-media'
  | 'group-messaging';

export interface TransportFeatureRow {
  feature: TransportFeature;
  supported: boolean;
  reason: string;
}

const BAILEYS_FEATURES: TransportFeatureRow[] = [
  { feature: 'text', supported: true, reason: 'Baileys text send/receive' },
  { feature: 'rich-media', supported: true, reason: 'Baileys image, video, and document send' },
  { feature: 'receipts', supported: true, reason: 'Baileys receipt events' },
  { feature: 'templates', supported: false, reason: 'template sending is a Meta Cloud feature' },
  { feature: 'reactions', supported: true, reason: 'Baileys reaction messages' },
  { feature: 'voice-notes', supported: true, reason: 'Baileys voice-note upload pipeline' },
  { feature: 'inbound-media', supported: true, reason: 'Baileys parses and downloads media messages' },
  { feature: 'group-messaging', supported: true, reason: 'Baileys group addressing' }
];

const META_CLOUD_FEATURES: TransportFeatureRow[] = [
  { feature: 'text', supported: true, reason: 'Cloud API text messages' },
  { feature: 'rich-media', supported: true, reason: 'Cloud API media messages and rich template headers' },
  { feature: 'receipts', supported: true, reason: 'Cloud API sent/delivered/read webhooks' },
  { feature: 'templates', supported: true, reason: 'approved Cloud API template messages' },
  { feature: 'reactions', supported: false, reason: 'not exposed by the Meta Cloud transport' },
  { feature: 'voice-notes', supported: false, reason: 'the voice pipeline is Baileys-only' },
  { feature: 'inbound-media', supported: false, reason: 'media webhooks surface as explicit unsupported content, never downloaded' },
  { feature: 'group-messaging', supported: false, reason: 'Meta transport addresses verified direct phone numbers only' }
];

export type TransportKind = 'baileys' | 'meta-cloud';

export function transportCapabilities(mode: TransportKind): TransportFeatureRow[] {
  return (mode === 'meta-cloud' ? META_CLOUD_FEATURES : BAILEYS_FEATURES).map((row) => Object.assign({}, row));
}

export function supportsFeature(rows: TransportFeatureRow[], feature: TransportFeature): boolean {
  return rows.find((row) => row.feature === feature)?.supported === true;
}
