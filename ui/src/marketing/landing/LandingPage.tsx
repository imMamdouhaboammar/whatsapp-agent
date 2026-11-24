import React, { useEffect, useMemo, useState } from 'react';
import { CORE_CONTENT } from './data/core';
import type { Locale, VerticalConfig, VerticalSlug } from './types';
import { InteractiveLeadFunnel } from '../lead-funnel/InteractiveLeadFunnel';
import type { IndustryId } from '../lead-funnel/types';

interface LandingPageProps {
  vertical: VerticalConfig;
  initialLocale?: Locale;
  /** WhatsApp number in international format without +, e.g. "2010XXXXXXXX" */
  salesWhatsappNumber?: string;
  /** GitHub repo or self-hosted docs URL */
  freeDownloadUrl?: string;
}

const LOCALES: Locale[] = ['eg', 'gcc', 'en'];

function getIndustryIdFromVertical(slug: VerticalSlug): IndustryId {
  if (slug === 'clinics') return 'medical';
  if (slug === 'real-estate') return 'real_estate';
  if (slug === 'ecommerce') return 'ecommerce';
  return 'medical';
}

export const LandingPage: React.FC<LandingPageProps> = ({
  vertical,
  initialLocale = 'eg',
  salesWhatsappNumber,
  freeDownloadUrl,
}) => {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  const resolvedSalesNumber =
    salesWhatsappNumber ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SALES_WHATSAPP_NUMBER
      ? String(import.meta.env.VITE_SALES_WHATSAPP_NUMBER)
      : '201000000000');

  const resolvedFreeDownloadUrl =
    freeDownloadUrl ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FREE_DOWNLOAD_URL
      ? String(import.meta.env.VITE_FREE_DOWNLOAD_URL)
      : 'https://github.com/imMamdouhaboammar/whatsapp-agent');

  const core = CORE_CONTENT[locale];
  const content = vertical.locales[locale];
  const industryId = getIndustryIdFromVertical(vertical.slug);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = content.metaTitle;
      document.documentElement.dir = core.dir;
      document.documentElement.lang = core.langCode;

      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        metaDesc.setAttribute('content', content.metaDescription);
      }
    }
  }, [content.metaTitle, content.metaDescription, core.dir, core.langCode]);

  const directWhatsappHref = useMemo(() => {
    const cleanNumber = resolvedSalesNumber.replace(/[^\d]/g, '');
    const encodedText = encodeURIComponent(content.whatsappPrefillMessage);
    return `https://wa.me/${cleanNumber}?text=${encodedText}`;
  }, [resolvedSalesNumber, content.whatsappPrefillMessage]);

  const allFaqs = useMemo(
    () => [...content.verticalFaqs, ...core.coreFaqs],
    [content.verticalFaqs, core.coreFaqs],
  );

  const handleHeroCtaClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof document !== 'undefined') {
      const el = document.getElementById('assessment-funnel');
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  return (
    <div
      dir={core.dir}
      lang={core.langCode}
      className="min-h-screen bg-slate-950 text-slate-100 antialiased"
    >
      {/* Top Bar & Locale Switcher */}
      <header className="border-b border-slate-800/80 bg-slate-950/90 sticky top-0 z-20 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-tight text-emerald-400">
            {content.badge}
          </span>

          <nav aria-label="Language switcher" className="flex items-center gap-2">
            {LOCALES.map((loc) => {
              const isActive = loc === locale;
              return (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLocale(loc)}
                  aria-pressed={isActive}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    isActive
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {CORE_CONTENT[loc].localeLabel}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16 space-y-24">
        {/* Hero Section */}
        <section className="space-y-6 text-center max-w-3xl mx-auto">
          <h1 className="text-3xl sm:text-5xl font-bold leading-tight tracking-tight text-white">
            {content.heroHeadline}
          </h1>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300">
            {content.heroSubheadline}
          </p>
          <div className="pt-4 flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href="#assessment-funnel"
                onClick={handleHeroCtaClick}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-8 py-4 text-base font-semibold text-slate-950 hover:bg-emerald-400 transition shadow-lg shadow-emerald-500/20"
              >
                {content.primaryCtaLabel}
              </a>
              <a
                href={directWhatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-6 py-4 text-sm font-medium text-slate-200 hover:bg-slate-800 transition"
              >
                {locale === 'en' ? 'Direct WhatsApp Chat' : 'واتساب مباشر'}
              </a>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 max-w-xl">
              {content.trustLine}
            </p>
          </div>
        </section>

        {/* Embedded Interactive Lead Funnel (Pre-seeded with this vertical) */}
        <section id="assessment-funnel" className="space-y-6 scroll-mt-24">
          <div className="text-center space-y-2 max-w-2xl mx-auto">
            <span className="inline-block rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
              {locale === 'en' ? 'Interactive Assessment' : 'تقييم تشغيلي تفاعلي في دقيقتين'}
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              {locale === 'en'
                ? 'Assess Setup & AI Eligibility for Your Operation'
                : 'اكتشف خطة التشغيل المناسبة وحجم التوفير لعيادتك'}
            </h2>
            <p className="text-sm text-slate-300">
              {locale === 'en'
                ? 'Answer quick operational questions to receive your tailored module, VPS recommendation, and Vertex AI credit plan.'
                : 'جاوب على أسئلة سريعة لاختيار موديول الرد المناسب، فحص رصيد 300 دولار، وتجهيز خطة الـ Pilot فوراً.'}
            </p>
          </div>

          <InteractiveLeadFunnel
            initialIndustry={industryId}
            salesWhatsappNumber={resolvedSalesNumber}
            freeDownloadUrl={resolvedFreeDownloadUrl}
          />
        </section>

        {/* Problem Section */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 sm:p-10 space-y-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            {content.problemHeading}
          </h2>
          <p className="text-slate-300 leading-relaxed">{content.problemIntro}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {content.problemBullets.map((bullet) => (
              <li
                key={bullet}
                className="flex items-start gap-3 rounded-xl bg-slate-950/70 p-4 text-sm text-slate-200 border border-slate-800/80"
              >
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
          <p className="text-slate-300 leading-relaxed pt-2">
            {content.problemClosing}
          </p>
        </section>

        {/* Features Section */}
        <section className="space-y-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            {content.featuresHeading}
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {content.features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-2"
              >
                <h3 className="text-lg font-semibold text-emerald-400">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-300">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Privacy & Vertical Guardrails */}
        <section className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-8 sm:p-10 space-y-4">
          <h2 className="text-2xl font-bold text-white">
            {content.guardrailsHeading}
          </h2>
          {content.guardrailsParagraphs.map((paragraph) => (
            <p key={paragraph} className="text-slate-200 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>

        {/* Shared Pricing & Vertex AI Credit Section */}
        <section className="space-y-8">
          <div className="space-y-3">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              {core.pricingHeading}
            </h2>
            <p className="text-slate-300 leading-relaxed">{core.pricingIntro}</p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
              <h3 className="text-lg font-semibold text-white">
                {core.pricing.coreTitle}
              </h3>
              <p className="text-sm leading-relaxed text-slate-300">
                {core.pricing.coreDescription}
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-500/40 bg-slate-900 p-6 space-y-3">
              <h3 className="text-lg font-semibold text-emerald-400">
                {core.pricing.vertexTitle}
              </h3>
              <p className="text-sm leading-relaxed text-slate-200">
                {core.pricing.vertexDescription}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
              <h3 className="text-lg font-semibold text-white">
                {core.pricing.retainerTitle}
              </h3>
              <p className="text-base font-bold text-emerald-400">
                {core.pricing.retainerPriceRange}
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                {core.pricing.retainerDescription}
              </p>
            </div>
          </div>
        </section>

        {/* Roadmap Section */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 space-y-3">
          <h2 className="text-xl font-bold text-white">{core.roadmapHeading}</h2>
          <p className="text-slate-300 leading-relaxed">
            {content.roadmapDescription}
          </p>
        </section>

        {/* FAQ Section */}
        <section className="space-y-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            {core.faqHeading}
          </h2>
          <div className="space-y-4">
            {allFaqs.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-2xl border border-slate-800 bg-slate-900/50 p-6"
              >
                <summary className="cursor-pointer list-none font-semibold text-white flex items-center justify-between gap-4">
                  <span>{faq.question}</span>
                  <span className="text-emerald-400 transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-4 text-sm leading-relaxed text-slate-300">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="rounded-3xl border border-emerald-500/30 bg-slate-900 p-10 text-center space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            {content.finalCtaHeading}
          </h2>
          <p className="text-slate-300 max-w-2xl mx-auto">
            {content.finalCtaSubheadline}
          </p>
          <div className="pt-2">
            <a
              href={directWhatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-8 py-4 text-base font-semibold text-slate-950 hover:bg-emerald-400 transition"
            >
              {content.finalCtaButton}
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/80 py-8 text-center text-xs text-slate-500">
        {core.footerNote}
      </footer>
    </div>
  );
};
