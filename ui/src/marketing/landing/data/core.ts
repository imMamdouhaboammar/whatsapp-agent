import type { CoreLocaleContent, Locale } from '../types';

export const CORE_CONTENT: Record<Locale, CoreLocaleContent> = {
  eg: {
    dir: 'rtl',
    langCode: 'ar-EG',
    localeLabel: 'مصر',
    pricingHeading: 'التكلفة الحقيقية وعرض رصيد جوجل',
    pricingIntro:
      'بدل ما تدفع اشتراكات منصات بالآلاف كل شهر أو عمولات وسطاء على الرسايل، معادلة التشغيل عندك واضحة',
    pricing: {
      coreTitle: 'التطبيق الأساسي (Self-Hosted)',
      coreDescription:
        'مجاني بالكامل وتقدر تشغله على جهازك بإمكانيات بسيطة أو ترفعه على VPS رخيص خاص بيك',
      vertexTitle: 'رصيد Google Cloud Vertex AI بقيمة 300 دولار',
      vertexDescription:
        'بنساعدك خطوة بخطوة تفعل الرصيد التجريبي الرسمي من جوجل للحسابات الجديدة المؤهلة (صالح لمدة 90 يوم وبيحتاج كارت بنكي للتحقق من الهوية) لتشغيل موديلات Gemini بسرعة وثبات أول 3 شهور',
      retainerTitle: 'باقة التجهيز والمتابعة الشهرية (اختيارية)',
      retainerPriceRange: '300 – 999 جنيه / شهرياً',
      retainerDescription:
        'حسب حجم البيزنس وعدد الرسايل، شاملة التركيب، تفعيل Vertex AI، تدريب الوكيل على ملف شغلك، التحديثات، والدعم الفني',
    },
    roadmapHeading: 'إضافات جاية قريباً (Roadmap)',
    faqHeading: 'أسئلة بتتكرر قبل البداية',
    coreFaqs: [
      {
        question: 'هل محتاج جهاز بمواصفات عالية عشان أشغل التطبيق',
        answer:
          'لأ، التطبيق خفيف وبيشتغل على جهاز مكتبي عادي أو على VPS اقتصادي',
      },
      {
        question: 'هل رصيد الـ 300 دولار من جوجل مضمون ومدى الحياة',
        answer:
          'الرصيد ده عرض تجريبي رسمي من Google Cloud للحسابات الجديدة المؤهلة وصلاحيته 90 يوم، وبيحتاج كارت بنكي صالح للتحقق وقت التفعيل، ودورنا إننا نجهزلك الربط بشكل سليم عشان تستفيد منه بأعلى كفاءة خلال أول 3 شهور وبعدها بتحاسب جوجل مباشرة حسب استهلاكك الفعلي',
      },
      {
        question: 'هل في خطورة حظر على رقم الواتساب',
        answer:
          'الاستخدام الأساسي للرد على رسايل العملاء الواردة بضوابط سرعة طبيعية بيحافظ على أمان الرقم، وكمان التطبيق جاهز للعمل مع Meta Cloud API الرسمي لو بتبعت حملات بأعداد كبيرة',
      },
    ],
    footerNote: 'تطبيق Self-Hosted بملكية كاملة لبياناتك ومحادثات عملائك',
  },

  gcc: {
    dir: 'rtl',
    langCode: 'ar-SA',
    localeLabel: 'الخليج',
    pricingHeading: 'هيكل التكلفة وميزة رصيد Google Cloud',
    pricingIntro:
      'بدلاً من الاشتراكات الشهرية المرتفعة وتكاليف رسايل التسويق والمتابعة، تحصل على معادلة تشغيل واضحة ومباشرة',
    pricing: {
      coreTitle: 'التطبيق الأساسي (Self-Hosted)',
      coreDescription:
        'مجاني وتملكه بالكامل على جهازك أو على خادم VPS خاص بشركتك',
      vertexTitle: 'رصيد Google Cloud Vertex AI بقيمة 300 دولار',
      vertexDescription:
        'ضمن خدمة الإعداد نساعدك خطوة بخطوة على تفعيل الرصيد التجريبي الرسمي من جوجل للحسابات الجديدة المؤهلة (صالح لمدة 90 يوم ويتطلب بطاقة بنكية للتحقق) لتشغيل موديلات Gemini بسرعة وثبات خلال فترة الإطلاق الأولى',
      retainerTitle: 'باقة التشغيل والدعم الشهري (اختيارية)',
      retainerPriceRange: '99 – 300 ريال أو درهم / شهرياً',
      retainerDescription:
        'حسب حجم النشاط، وتشمل التثبيت، ضبط ملف المعرفة الخاص بعملك، ربط Vertex AI، التحديثات المستمرة، والدعم الفني',
    },
    roadmapHeading: 'إضافات قادمة في خارطة الطريق (Roadmap)',
    faqHeading: 'الأسئلة الشائعة',
    coreFaqs: [
      {
        question: 'هل يتطلب التطبيق خادماً مكلفاً',
        answer:
          'لا، يعمل بكفاءة على خادم VPS اقتصادي أو جهاز مكتبي بمواصفات أساسية',
      },
      {
        question: 'ما شروط الاستفادة من رصيد 300 دولار في Vertex AI',
        answer:
          'الرصيد مقدم رسمياً من Google Cloud للحسابات الجديدة المؤهلة لمدة 90 يوماً ويتطلب بطاقة دفع صالحة للتحقق لدى جوجل، ونحن نجهز الربط التقني بالكامل لتستفيد منه بشكل صحيح خلال أول ثلاثة أشهر',
      },
      {
        question: 'كيف نحمي رقم الواتساب من الحظر',
        answer:
          'التركيز على الرد على استفسارات العملاء الواردة بوتيرة إرسال طبيعية يحافظ على استقرار الرقم، كما يدعم التطبيق الربط عبر Meta Cloud API الرسمي للجهات التي ترسل حملات واسعة',
      },
    ],
    footerNote: 'حل Self-Hosted يمنحك ملكية كاملة لبياناتك ومحادثات عملائك',
  },

  en: {
    dir: 'ltr',
    langCode: 'en',
    localeLabel: 'English',
    pricingHeading: 'Transparent Cost Structure & $300 Vertex AI Setup',
    pricingIntro:
      'Skip bloated monthly SaaS subscriptions and per-message BSP markups with a clear, owner-controlled setup.',
    pricing: {
      coreTitle: 'Self-Hosted Core App',
      coreDescription:
        'Free to run on your own low-spec machine or a private entry-level VPS.',
      vertexTitle: 'Official $300 Google Cloud Vertex AI Credit',
      vertexDescription:
        'During onboarding, we guide eligible new Google Cloud accounts step by step to activate Google’s official 90-day $300 trial credit (requires a valid payment card for Google verification) so you run fast Gemini models from day one.',
      retainerTitle: 'Optional Monthly Care & Support Retainer',
      retainerPriceRange: '300–999 EGP / mo (Egypt) · 99–300 SAR/AED / mo (GCC)',
      retainerDescription:
        'Covers installation, brand knowledge setup, Vertex AI configuration, ongoing updates, and direct technical support.',
    },
    roadmapHeading: 'Upcoming Modular Plugins (Roadmap)',
    faqHeading: 'Frequently Asked Questions',
    coreFaqs: [
      {
        question: 'Do we need an expensive server to run this?',
        answer:
          'No. The agent is built to run reliably on a basic office computer or a low-cost VPS.',
      },
      {
        question: 'Is the $300 Vertex AI credit permanent?',
        answer:
          'It is an official 90-day free trial provided by Google Cloud for eligible new accounts with a valid verification card. Our team configures the integration cleanly so you get full value during your first three months before standard pay-as-you-go Google billing applies.',
      },
      {
        question: 'How do you protect our WhatsApp number from bans?',
        answer:
          'Handling inbound inquiries with natural reply pacing keeps everyday operations safe, and the codebase also supports the official Meta Cloud API for teams running high-volume outbound campaigns.',
      },
    ],
    footerNote: 'Self-hosted architecture with full ownership of your data and chat history.',
  },
};
