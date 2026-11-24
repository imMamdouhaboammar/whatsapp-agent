import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  advanceFromLoader,
  buildFinalBlueprint,
  createInitialSession,
  goBack,
  renderCurrentNode,
  selectOption,
  type EngineContext,
} from './engine';
import { CORE_SPINE, INDUSTRY_PACKS } from './registry';
import type { FunnelAnalyticsEvent, IndustryId, UserSession } from './types';

export interface InteractiveLeadFunnelProps {
  /** WhatsApp sales number without +, e.g. "2010XXXXXXXX" */
  salesWhatsappNumber?: string;
  /** GitHub repo or self-hosted docs URL for DIY technical users */
  freeDownloadUrl?: string;
  /** Optional pre-seeded industry when launching from a vertical landing page */
  initialIndustry?: IndustryId;
  /** Optional analytics hook (Microsoft Clarity, GA4, PostHog, etc.) */
  onEvent?: (event: FunnelAnalyticsEvent) => void;
}

const LOADER_STAGES = [
  'جاري ضبط قواعد الرد والـ Guardrails المناسبة لمجالك',
  'جاري حساب مواصفات الجهاز أو الـ VPS المناسبة لحجم رسايلك',
  'جاري فحص أهلية تفعيل رصيد 300 دولار على Google Cloud Vertex AI',
];

export const InteractiveLeadFunnel: React.FC<InteractiveLeadFunnelProps> = ({
  salesWhatsappNumber,
  freeDownloadUrl,
  initialIndustry,
  onEvent,
}) => {
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

  const [session, setSession] = useState<UserSession>(() =>
    createInitialSession(initialIndustry),
  );
  const [loaderStep, setLoaderStep] = useState<number>(0);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  const engineCtx: EngineContext = useMemo(
    () => ({
      coreSpine: CORE_SPINE,
      industries: INDUSTRY_PACKS,
      salesWhatsappNumber: resolvedSalesNumber,
      freeDownloadUrl: resolvedFreeDownloadUrl,
    }),
    [resolvedSalesNumber, resolvedFreeDownloadUrl],
  );

  const emit = useCallback(
    (payload: Omit<FunnelAnalyticsEvent, 'sessionId' | 'timestamp'>) => {
      const fullEvent: FunnelAnalyticsEvent = {
        ...payload,
        sessionId: session.sessionId,
        timestamp: Date.now(),
      };

      if (onEvent) {
        onEvent(fullEvent);
      }

      if (typeof window !== 'undefined') {
        const win = window as any;
        if (typeof win.clarity === 'function') {
          try {
            win.clarity('event', fullEvent.event, {
              nodeId: fullEvent.nodeId,
              industryId: fullEvent.industryId,
              painScore: fullEvent.painScore,
              optionId: fullEvent.optionId,
            });
          } catch {
            // ignore clarity failure
          }
        }
        if (Array.isArray(win.dataLayer)) {
          try {
            win.dataLayer.push({
              event: fullEvent.event,
              funnel_session_id: fullEvent.sessionId,
              funnel_node_id: fullEvent.nodeId,
              funnel_industry_id: fullEvent.industryId,
              funnel_pain_score: fullEvent.painScore,
              funnel_option_id: fullEvent.optionId,
            });
          } catch {
            // ignore dataLayer failure
          }
        }
      }
    },
    [onEvent, session.sessionId],
  );

  // Fire initial start event once
  useEffect(() => {
    emit({
      event: 'funnel_started',
      industryId: initialIndustry ?? null,
      nodeId: initialIndustry ? 'q02_ops_mode' : 'q01_industry',
      painScore: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isResultScreen = session.currentNodeId === 'result_blueprint';

  const renderedNode = useMemo(() => {
    if (isResultScreen) return null;
    try {
      return renderCurrentNode(engineCtx, session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected funnel error';
      setEngineError(message);
      return null;
    }
  }, [engineCtx, session, isResultScreen]);

  const blueprint = useMemo(() => {
    if (!isResultScreen) return null;
    return buildFinalBlueprint(engineCtx, session);
  }, [engineCtx, session, isResultScreen]);

  // Animate 3-step loader and transition to final blueprint
  useEffect(() => {
    if (session.currentNodeId !== 'loader_15' || typeof window === 'undefined') {
      setLoaderStep(0);
      return;
    }

    const t1 = window.setTimeout(() => setLoaderStep(1), 850);
    const t2 = window.setTimeout(() => setLoaderStep(2), 1700);
    const t3 = window.setTimeout(() => {
      setSession((prev) => {
        const next = advanceFromLoader(prev);
        emit({
          event: 'funnel_completed',
          industryId: next.industryId,
          nodeId: 'result_blueprint',
          painScore: next.painScore,
        });
        return next;
      });
    }, 2600);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [session.currentNodeId, emit]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      try {
        setEngineError(null);
        const { nextSession, triggeredObjection } = selectOption(
          engineCtx,
          session,
          optionId,
        );

        emit({
          event: 'funnel_step_completed',
          industryId: nextSession.industryId,
          nodeId: session.currentNodeId,
          optionId,
          nextNodeId: nextSession.currentNodeId,
          painScore: nextSession.painScore,
        });

        if (triggeredObjection) {
          emit({
            event: 'funnel_objection_triggered',
            industryId: nextSession.industryId,
            nodeId: session.currentNodeId,
            optionId,
            nextNodeId: nextSession.currentNodeId,
            painScore: nextSession.painScore,
          });
        }

        setSession(nextSession);
      } catch (err) {
        setEngineError(err instanceof Error ? err.message : 'Failed to advance funnel');
      }
    },
    [engineCtx, session, emit],
  );

  const handleGoBack = useCallback(() => {
    setEngineError(null);
    const prevSession = goBack(session);
    emit({
      event: 'funnel_step_back',
      industryId: prevSession.industryId,
      nodeId: session.currentNodeId,
      nextNodeId: prevSession.currentNodeId,
      painScore: prevSession.painScore,
    });
    setSession(prevSession);
  }, [session, emit]);

  const handleRestart = useCallback(() => {
    setEngineError(null);
    setCopiedSummary(false);
    setSession(createInitialSession(initialIndustry));
  }, [initialIndustry]);

  const handleCopySummary = useCallback(async () => {
    if (!blueprint) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(blueprint.whatsappSummaryText);
        setCopiedSummary(true);
        if (typeof window !== 'undefined') {
          window.setTimeout(() => setCopiedSummary(false), 2500);
        }
      }
    } catch {
      setCopiedSummary(false);
    }
  }, [blueprint]);

  // Keyboard shortcuts (1-6 to pick option, Escape to go back)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!renderedNode || renderedNode.type === 'loader') return;

      if (e.key === 'Escape' && renderedNode.canGoBack) {
        handleGoBack();
        return;
      }

      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < renderedNode.options.length) {
        handleSelectOption(renderedNode.options[idx].id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [renderedNode, handleGoBack, handleSelectOption]);

  // Error fallback UI
  if (engineError) {
    return (
      <div
        dir="rtl"
        className="mx-auto max-w-2xl rounded-3xl border border-red-500/40 bg-slate-900 p-8 text-center text-slate-100 space-y-4"
      >
        <p className="text-lg font-bold text-red-400">حصل خطأ غير متوقع في تحميل الخطوة</p>
        <p className="text-sm text-slate-400">{engineError}</p>
        <button
          type="button"
          onClick={handleRestart}
          className="rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition"
        >
          إعادة البدء من الأول
        </button>
      </div>
    );
  }

  // Final Result Blueprint Screen
  if (isResultScreen && blueprint) {
    const scoreColor =
      blueprint.painTier === 'high'
        ? 'text-amber-400 border-amber-500/40 bg-amber-500/10'
        : blueprint.painTier === 'medium'
          ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
          : 'text-sky-400 border-sky-500/40 bg-sky-500/10';

    return (
      <section
        dir="rtl"
        lang="ar-EG"
        className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-950 p-6 sm:p-10 text-slate-100 shadow-2xl space-y-8"
      >
        {/* Result Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="space-y-1">
            <span className="inline-block rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
              خطة التشغيل المخصصة — {blueprint.industryName}
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              {blueprint.moduleName}
            </h2>
          </div>

          <div className={`rounded-2xl border px-4 py-3 text-center shrink-0 ${scoreColor}`}>
            <div className="text-xs opacity-80">مؤشر الضغط التشغيلي</div>
            <div className="text-2xl font-extrabold">{blueprint.painScore}/100</div>
          </div>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed">
          {blueprint.painTierLabel}
        </p>

        {/* 3 Concrete Personalized Specs */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-2">
            <div className="text-xs font-semibold text-emerald-400">البنية المقترحة</div>
            <p className="text-sm leading-relaxed text-slate-200">
              {blueprint.infraRecommendation}
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 space-y-2">
            <div className="text-xs font-semibold text-emerald-400">
              تشغيل الذكاء الاصطناعي
            </div>
            <p className="text-sm leading-relaxed text-slate-100">{blueprint.aiPlan}</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-2">
            <div className="text-xs font-semibold text-emerald-400">المسار الأنسب ليك</div>
            <p className="text-sm leading-relaxed text-slate-200">
              {blueprint.recommendedTier}
            </p>
          </div>
        </div>

        {/* Live Simulated WhatsApp Conversation for Their Industry */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">
              مثال حي لشكل رد الوكيل في {blueprint.industryName}
            </span>
            <span className="text-[11px] text-emerald-400">متصل الآن • Gemini</span>
          </div>

          <div className="space-y-3">
            {blueprint.sampleConversation.map((msg, i) => (
              <div
                key={`${msg.sender}-${i}`}
                className={`flex ${
                  msg.sender === 'customer' ? 'justify-start' : 'justify-end'
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.sender === 'customer'
                      ? 'bg-slate-800 text-slate-100 rounded-tr-none'
                      : 'bg-emerald-600/25 border border-emerald-500/40 text-emerald-50 rounded-tl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Primary CTA & Utility Actions */}
        <div className="space-y-4 pt-2">
          <a
            href={blueprint.ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              emit({
                event: 'funnel_cta_clicked',
                industryId: blueprint.industryId,
                nodeId: 'result_blueprint',
                optionId: blueprint.ctaMode,
                painScore: blueprint.painScore,
              })
            }
            className="flex w-full items-center justify-center rounded-2xl bg-emerald-500 px-8 py-4 text-base font-bold text-slate-950 hover:bg-emerald-400 transition"
          >
            {blueprint.ctaLabel}
          </a>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <button
              type="button"
              onClick={handleCopySummary}
              className="hover:text-slate-200 underline underline-offset-4 transition"
            >
              {copiedSummary ? 'تم نسخ ملخص إجاباتك بنجاح' : 'نسخ ملخص خطة التشغيل'}
            </button>

            <button
              type="button"
              onClick={handleRestart}
              className="hover:text-slate-200 underline underline-offset-4 transition"
            >
              إعادة التقييم لمجال تاني
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!renderedNode) return null;

  // Animated 3-Step Loader Screen
  if (renderedNode.type === 'loader') {
    return (
      <section
        dir="rtl"
        lang="ar-EG"
        className="mx-auto max-w-2xl rounded-3xl border border-slate-800 bg-slate-950 p-8 sm:p-12 text-slate-100 space-y-8"
      >
        <div className="space-y-2 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-800 border-t-emerald-400" />
          <h2 className="text-xl sm:text-2xl font-bold text-white pt-3">
            {renderedNode.title}
          </h2>
        </div>

        <ul className="space-y-3">
          {LOADER_STAGES.map((stage, idx) => {
            const done = idx <= loaderStep;
            return (
              <li
                key={stage}
                className={`flex items-center gap-3 rounded-xl border p-4 text-sm transition ${
                  done
                    ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                    : 'border-slate-800 bg-slate-900/40 text-slate-500'
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    done ? 'bg-emerald-400' : 'bg-slate-700'
                  }`}
                />
                <span>{stage}</span>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  // Question / Reaction / Objection Handler Screen
  const badgeText =
    renderedNode.type === 'reaction'
      ? 'واقع السوق — إيه رأيك'
      : renderedNode.type === 'objection_handler'
        ? 'توضيح سريع قبل ما نكمل'
        : `الخطوة ${renderedNode.stepNumber} من ${renderedNode.totalEstimatedSteps}`;

  const cardBorder =
    renderedNode.type === 'objection_handler'
      ? 'border-amber-500/40'
      : renderedNode.type === 'reaction'
        ? 'border-emerald-500/35'
        : 'border-slate-800';

  return (
    <section
      dir="rtl"
      lang="ar-EG"
      className={`mx-auto max-w-2xl rounded-3xl border ${cardBorder} bg-slate-950 p-6 sm:p-10 text-slate-100 shadow-2xl space-y-7`}
    >
      {/* Progress Bar & Navigation */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold text-emerald-400">{badgeText}</span>
          <span>{renderedNode.progressPercent}%</span>
        </div>

        <div
          role="progressbar"
          aria-valuenow={renderedNode.progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Funnel progress"
          className="h-2 w-full overflow-hidden rounded-full bg-slate-900"
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out"
            style={{ width: `${renderedNode.progressPercent}%` }}
          />
        </div>
      </div>

      {/* Prompt Title & Body */}
      <div className="space-y-3">
        <h2 className="text-xl sm:text-2xl font-bold leading-snug text-white">
          {renderedNode.title}
        </h2>
        {renderedNode.body && (
          <p className="text-sm sm:text-base leading-relaxed text-slate-300">
            {renderedNode.body}
          </p>
        )}
      </div>

      {/* Interactive Option Cards */}
      <div className="space-y-3">
        {renderedNode.options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            onClick={() => handleSelectOption(option.id)}
            className="group flex w-full items-start gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-right hover:border-emerald-500/60 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-xs font-bold text-slate-400 group-hover:border-emerald-500 group-hover:text-emerald-400">
              {index + 1}
            </span>
            <div className="space-y-1">
              <div className="text-sm sm:text-base font-medium text-slate-100 group-hover:text-white">
                {option.label}
              </div>
              {option.sublabel && (
                <div className="text-xs text-slate-400">{option.sublabel}</div>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Footer Back Navigation */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-900">
        {renderedNode.canGoBack ? (
          <button
            type="button"
            onClick={handleGoBack}
            className="text-xs font-medium text-slate-400 hover:text-white transition"
          >
            ← الرجوع للسؤال السابق
          </button>
        ) : (
          <span className="text-xs text-slate-500">
            اختار بضغطة واحدة — بدون كتابة
          </span>
        )}

        <span className="text-[11px] text-slate-500">
          الاختصارات: الأرقام 1–{renderedNode.options.length}
        </span>
      </div>
    </section>
  );
};
