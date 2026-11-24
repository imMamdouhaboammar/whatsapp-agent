export type Locale = 'eg' | 'gcc' | 'en';

export type VerticalSlug = 'clinics' | 'ecommerce' | 'real-estate';

export interface LocalizedText {
  eg: string;
  gcc: string;
  en: string;
}

export interface FeatureItem {
  title: string;
  description: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface PricingTierInfo {
  coreTitle: string;
  coreDescription: string;
  vertexTitle: string;
  vertexDescription: string;
  retainerTitle: string;
  retainerPriceRange: string;
  retainerDescription: string;
}

export interface CoreLocaleContent {
  dir: 'rtl' | 'ltr';
  langCode: string;
  localeLabel: string;
  pricingHeading: string;
  pricingIntro: string;
  pricing: PricingTierInfo;
  roadmapHeading: string;
  faqHeading: string;
  coreFaqs: FaqItem[];
  footerNote: string;
}

export interface VerticalLocaleContent {
  metaTitle: string;
  metaDescription: string;
  badge: string;
  heroHeadline: string;
  heroSubheadline: string;
  primaryCtaLabel: string;
  trustLine: string;
  problemHeading: string;
  problemIntro: string;
  problemBullets: string[];
  problemClosing: string;
  featuresHeading: string;
  features: FeatureItem[];
  guardrailsHeading: string;
  guardrailsParagraphs: string[];
  roadmapDescription: string;
  verticalFaqs: FaqItem[];
  finalCtaHeading: string;
  finalCtaSubheadline: string;
  finalCtaButton: string;
  whatsappPrefillMessage: string;
}

export interface VerticalConfig {
  slug: VerticalSlug;
  locales: Record<Locale, VerticalLocaleContent>;
}
