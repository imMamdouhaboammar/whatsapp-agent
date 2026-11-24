بما إنك شغال بـ React وTypeScript، عملتلك الهيكل كامل وجاهز للنسخ والتشغيل فوراً بنظام **70/30 Modular Architecture**، بحيث لما تحب تضيف مجال تاني زي العقارات أو المتاجر الإلكترونية كل اللي هتعمله إنك تزود ملف داتا واحد بس من غير ما تلمس كود الصفحة

الملفات متقسمة لـ 4 أجزاء كاملة بدون أي اختصار:

1. **`types.ts`** تعريف الأنواع الصارم عشان TypeScript يمنع أي نص ناقص في أي لغة أو مجال
2. **`core.ts`** الـ 70% الثابتة (منطق التسعير، عرض رصيد الـ 300 دولار، الـ Roadmap، وأزرار التبديل بين اللغات)
3. **`verticals/clinics.ts`** الـ 30% المخصصة للعيادات بالـ 3 لغات (`eg`، `gcc`، `en`)
4. **`LandingPage.tsx`** الكومبوننت اللي بيدمج الاتنين ويضبط اتجاه الصفحة `RTL / LTR` تلقائياً

---

### 1. `src/landing/types.ts`

```ts
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
```

---

### 2. `src/landing/data/core.ts` (الـ 70% المشتركة بين كل المجالات)

```ts
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
```

---

### 3. `src/landing/data/verticals/clinics.ts` (الـ 30% المخصصة للعيادات)

```ts
import type { VerticalConfig } from '../../types';

export const CLINICS_VERTICAL: VerticalConfig = {
  slug: 'clinics',
  locales: {
    eg: {
      metaTitle: 'وكيل واتساب ذكي للعيادات | رد وحجز مواعيد 24 ساعة',
      metaDescription:
        'تطبيق Self-Hosted مجاني لعيادتك يرد على المرضى ويحجز المواعيد بموديلات Google Gemini مع مساعدة لتفعيل رصيد 300 دولار من Vertex AI',
      badge: 'مخصص للعيادات والمراكز الطبية — مصر',
      heroHeadline:
        'وكيل واتساب ذكي لعيادتك يرد على المرضى ويحجز المواعيد 24 ساعة من غير اشتراكات شهرية بالآلاف',
      heroSubheadline:
        'شغل التطبيق مجاناً على جهاز العيادة أو على VPS بسيط، اربطه برقم الواتساب وموديلات Google Gemini، وخلي الرد على أسعار الكشف والمواعيد وتأكيد الحجوزات شغال طول اليوم والبيانات كلها عندك',
      primaryCtaLabel: 'احجز مكانك في تجربة الـ Pilot',
      trustLine:
        'التطبيق مجاني، مع مساعدة خطوة بخطوة لتفعيل رصيد 300 دولار رسمي من Google Cloud Vertex AI للحسابات الجديدة المؤهلة',
      problemHeading: 'واقع الرسايل في العيادة',
      problemIntro:
        'كل يوم رسايل كتير بتوصل على واتساب العيادة بعد مواعيد الشغل أو وقت ضغط الاستقبال، والأسئلة أغلبها متكرر',
      problemBullets: [
        'سعر الكشف كام ومواعيد الدكتور إمتى',
        'عنوان العيادة بالتفصيل واللوكيشن',
        'هل متاح حجز النهاردة أو بكرة',
        'إيه التحاليل أو التحضيرات المطلوبة قبل الزيارة',
      ],
      problemClosing:
        'لما الرد يتأخر ساعة أو اتنين، المريض بيكلم عيادة تانية، ولما تفكر تشترك في منصة أتمتة واتساب بتلاقي اشتراكات شهرية غالية بالدولار، وفوقها تكاليف رسايل تسويق ومتابعة على Business API',
      featuresHeading: 'إيه اللي بيعمله الوكيل لعيادتك يومياً',
      features: [
        {
          title: 'رد فوري بلهجة مصرية طبيعية',
          description:
            'بيجاوب على أسعار الكشف، الخدمات، مواعيد الأطباء، والعنوان في ثواني',
        },
        {
          title: 'تجميع بيانات الحجز',
          description:
            'ياخد اسم المريض، رقم التليفون، التخصص، والميعاد المناسب، ويجهزهم للاستقبال',
        },
        {
          title: 'تذكير ومتابعة المواعيد',
          description:
            'يبعت تعليمات ما قبل الكشف ويأكد حضور المريض قبل الميعاد عشان تقلل الغياب',
        },
        {
          title: 'التعامل مع الرسايل المتقطعة والفويس نوت',
          description:
            'يفهم الرسايل الصوتية والرسايل القصيرة اللي المريض بيبعتها ورا بعض ويرد برد واحد مرتب',
        },
      ],
      guardrailsHeading: 'خصوصية المرضى وحدود الرد الطبي',
      guardrailsParagraphs: [
        'بيانات المرضى ومحادثاتهم بتتخزن على جهاز العيادة أو على السيرفر الخاص بيك، ومش بتروح لمنصة طرف ثالث',
        'الوكيل بيتضبط على قواعد واضحة للعيادة، بيرد على الاستفسارات الإدارية والحجوزات والأسعار فقط، وأي سؤال طبي عن أعراض أو جرعات أو علاج بيتحول فوراً للفريق الطبي أو بيترد عليه بتوجيه المريض للحجز مع الدكتور',
      ],
      roadmapDescription:
        'بنبني حالياً متجر إضافات جوه التطبيق عشان تركب اللي عيادتك محتاجاه بس وقت ما تحتاجه، زي الربط المباشر مع Google Sheets لجدول المواعيد، والرد بالرسايل الصوتية، والربط مع برامج إدارة العيادات',
      verticalFaqs: [
        {
          question: 'هل الوكيل ممكن يوصف دواء أو يرد على استشارة طبية بالغلط',
          answer:
            'لأ، بنضبط قواعد الرد بحيث يقتصر على الأسعار والمواعيد والعنوان وتعليمات ما قبل الزيارة فقط، وأي سؤال طبي بيتوجه فوراً للفريق المختص أو للحجز مع الدكتور',
        },
      ],
      finalCtaHeading: 'جهز واتساب عيادتك للرد الفوري خلال أيام',
      finalCtaSubheadline:
        'إحنا فاتحين باب الاشتراك حالياً لعدد محدود من العيادات في مرحلة الـ Pilot بأسعار الإطلاق',
      finalCtaButton: 'اطلب تجربة Pilot لعيادتك',
      whatsappPrefillMessage:
        'أهلاً، عندي عيادة وحابب أشارك في تجربة الـ Pilot لتطبيق وكيل واتساب',
    },

    gcc: {
      metaTitle: 'وكيل واتساب ذكي للعيادات والمراكز الطبية | الخليج',
      metaDescription:
        'تطبيق Self-Hosted مجاني لعيادتك يرد على المراجعين وينسق المواعيد بموديلات Google Gemini مع دعم تفعيل رصيد 300 دولار من Vertex AI',
      badge: 'مخصص للعيادات والمراكز الطبية — السعودية والخليج',
      heroHeadline:
        'وكيل واتساب ذكي لعيادتك يرد على المراجعين وينسق المواعيد على مدار الساعة بملكية كاملة لبياناتك',
      heroSubheadline:
        'شغل التطبيق مجاناً على جهاز العيادة أو على خادم VPS خاص بمركزك الطبي، اربطه برقم الواتساب وموديلات Google Gemini، وتخلص من الاشتراكات الشهرية المرتفعة وتكاليف رسايل المتابعة',
      primaryCtaLabel: 'سجل عيادتك في المرحلة التجريبية',
      trustLine:
        'التطبيق مجاني بالكامل، مع مرافقة تقنية لتفعيل رصيد 300 دولار الرسمي من Google Cloud Vertex AI للحسابات الجديدة المؤهلة',
      problemHeading: 'لماذا تضيع حجوزات العيادة على واتساب',
      problemIntro:
        'وقت إطلاق الحملات الإعلانية أو بعد انتهاء الدوام، تتراكم استفسارات المراجعين حول الأسئلة المتكررة نفسها',
      problemBullets: [
        'أسعار الجلسات والكشوفات والعروض الحالية',
        'توفر المواعيد وأسماء الأطباء المناوبين',
        'موقع الفرع ومواعيد الدوام',
        'التعليمات المطلوبة قبل الجلسة أو الكشف',
      ],
      problemClosing:
        'تأخر الاستقبال في الرد يعني انتقال المراجع إلى عيادة أخرى خلال دقائق، بينما الحلول السحابية الجاهزة تفرض اشتراكات شهرية عالية وتكاليف إضافية على رسايل التسويق والمتابعة، مع بقاء محادثات مرضاك على خوادم خارجية',
      featuresHeading: 'مهام الوكيل داخل مركزك الطبي',
      features: [
        {
          title: 'رد فوري بلهجة خليجية أو عربية بيضاء طبيعية',
          description:
            'يجيب عن الأسعار، العروض، التخصصات، ومواعيد الأطباء بدقة في ثوانٍ',
        },
        {
          title: 'تجهيز بيانات الحجز',
          description:
            'يجمع اسم المراجع، رقم الجوال، الخدمة المطلوبة، والوقت المفضل لتأكيدها مباشرة من الاستقبال',
        },
        {
          title: 'تأكيد المواعيد وتقليل التغيب',
          description:
            'يرسل تعليمات ما قبل الجلسة ويذكر المراجع بموعده قبل الزيارة',
        },
        {
          title: 'فهم الرسايل الصوتية والرسايل المتتابعة',
          description:
            'يتعامل مع الفويس نوت والرسايل القصيرة المتفرقة ويرد بإجابة واحدة واضحة',
        },
      ],
      guardrailsHeading: 'خصوصية المراجعين والانضباط الطبي',
      guardrailsParagraphs: [
        'كل محادثات المراجعين وبياناتهم تبقى داخل خادم عيادتك وتحت إدارتك الكاملة، بدون مشاركتها مع منصات طرف ثالث',
        'يعمل الوكيل وفق حدود واضحة لمركزك الطبي، فيتولى الاستفسارات الإدارية والحجوزات والأسعار فقط، ويحول أي استفسار طبي أو سؤال عن الأعراض والأدوية مباشرة إلى الطبيب المختص أو طاقم التمريض',
      ],
      roadmapDescription:
        'نعمل حالياً على متجر إضافات مدمج داخل التطبيق يتيح لمركزك تثبيت ما يحتاجه فقط عند الحاجة، مثل الربط المباشر مع جداول Google Sheets، والردود الصوتية، والربط مع برامج إدارة العيادات',
      verticalFaqs: [
        {
          question: 'هل يقدم الوكيل تشخيصاً طبياً أو توصيات دوائية للمراجعين',
          answer:
            'لا، يتم تقييد الوكيل بالكامل بالرد على الحجوزات والأسعار والمواعيد وتعليمات ما قبل الزيارة فقط، مع تحويل أي استفسار طبي مباشر إلى الطاقم المختص',
        },
      ],
      finalCtaHeading: 'فعّل الرد الفوري على واتساب عيادتك هذا الأسبوع',
      finalCtaSubheadline:
        'المرحلة التجريبية مفتوحة حالياً لعدد محدود من العيادات والمراكز الطبية في السعودية والإمارات والخليج',
      finalCtaButton: 'احجز جلسة الإعداد التجريبي',
      whatsappPrefillMessage:
        'السلام عليكم، ندير مركزاً طبياً ونرغب بالتسجيل في المرحلة التجريبية لوكيل واتساب',
    },

    en: {
      metaTitle: 'Self-Hosted WhatsApp AI Agent for Clinics | 24/7 Patient Booking',
      metaDescription:
        'Free self-hosted WhatsApp AI agent for clinics powered by Google Gemini, with guided onboarding for Google Cloud’s official $300 Vertex AI trial credit.',
      badge: 'Built for Clinics & Medical Centers',
      heroHeadline:
        'A Self-Hosted WhatsApp AI Agent for Your Clinic That Books Patients 24/7 Without Heavy Monthly SaaS Bills',
      heroSubheadline:
        'Run the core app for free on your clinic computer or a low-cost VPS, connect your WhatsApp number and Google Gemini models directly, and handle pricing, doctor schedules, and appointment inquiries around the clock while keeping full ownership of your patient conversations.',
      primaryCtaLabel: 'Join the Clinic Pilot',
      trustLine:
        'Free self-hosted core app, plus guided setup to help eligible new accounts activate Google Cloud’s official $300 Vertex AI free trial credit.',
      problemHeading: 'The Daily WhatsApp Bottleneck in Clinics',
      problemIntro:
        'Front desks get flooded during peak hours, and ad leads often message late at night asking the exact same questions:',
      problemBullets: [
        'Consultation fees and available treatments',
        'Doctor schedules and branch directions',
        'Same-day or next-day booking availability',
        'Pre-visit preparation instructions',
      ],
      problemClosing:
        'Slow replies send ready patients straight to competing clinics, while cloud chatbot platforms charge steep monthly subscriptions alongside per-message marketing and follow-up costs on Business API.',
      featuresHeading: 'What Your Clinic Agent Handles Automatically',
      features: [
        {
          title: 'Instant, Natural Replies',
          description:
            'Answers questions on consultation fees, treatments, doctor hours, and clinic directions in seconds.',
        },
        {
          title: 'Structured Booking Intake',
          description:
            'Collects the patient’s name, phone number, requested service, and preferred slot ready for your reception team.',
        },
        {
          title: 'Appointment Reminders',
          description:
            'Sends pre-visit instructions and confirmations to cut down on no-shows.',
        },
        {
          title: 'Voice Notes & Burst Messages',
          description:
            'Transcribes patient voice notes and groups rapid-fire text messages into one clear reply.',
        },
      ],
      guardrailsHeading: 'Patient Privacy & Strict Medical Guardrails',
      guardrailsParagraphs: [
        'Every chat log and patient detail stays on your own machine or private VPS instead of sitting on a third-party SaaS cloud.',
        'The agent is configured with clear clinical boundaries, handling administrative inquiries, scheduling, and pricing only, while routing any medical questions, symptoms, or prescription requests directly to your doctors or nursing staff.',
      ],
      roadmapDescription:
        'We are building an in-app plugin store so your clinic installs only the add-ons it needs as you grow, including live Google Sheets schedule sync, voice replies, and clinic management connectors.',
      verticalFaqs: [
        {
          question: 'Can the agent accidentally give medical advice or prescriptions?',
          answer:
            'No. Strict guardrails keep the agent focused on scheduling, pricing, directions, and pre-visit logistics, automatically escalating medical questions to your clinical team.',
        },
      ],
      finalCtaHeading: 'Put Your Clinic’s WhatsApp on Instant Response',
      finalCtaSubheadline:
        'We are onboarding a small group of clinics into our early Pilot program with dedicated setup and launch pricing.',
      finalCtaButton: 'Request Your Clinic Pilot Slot',
      whatsappPrefillMessage:
        'Hi, I run a clinic and would like to request a slot in the WhatsApp AI Agent Pilot.',
    },
  },
};
```

---

### 4. `src/landing/LandingPage.tsx` (الكومبوننت الموحد اللي بيعرض أي مجال وأي لغة)

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { CORE_CONTENT } from './data/core';
import type { Locale, VerticalConfig } from './types';

interface LandingPageProps {
  vertical: VerticalConfig;
  initialLocale?: Locale;
  /** WhatsApp number in international format without +, e.g. "2010XXXXXXXX" */
  salesWhatsappNumber: string;
}

const LOCALES: Locale[] = ['eg', 'gcc', 'en'];

export const LandingPage: React.FC<LandingPageProps> = ({
  vertical,
  initialLocale = 'eg',
  salesWhatsappNumber,
}) => {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  const core = CORE_CONTENT[locale];
  const content = vertical.locales[locale];

  useEffect(() => {
    document.title = content.metaTitle;
    document.documentElement.dir = core.dir;
    document.documentElement.lang = core.langCode;

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', content.metaDescription);
    }
  }, [content.metaTitle, content.metaDescription, core.dir, core.langCode]);

  const ctaHref = useMemo(() => {
    const cleanNumber = salesWhatsappNumber.replace(/[^\d]/g, '');
    const encodedText = encodeURIComponent(content.whatsappPrefillMessage);
    return `https://wa.me/${cleanNumber}?text=${encodedText}`;
  }, [salesWhatsappNumber, content.whatsappPrefillMessage]);

  const allFaqs = useMemo(
    () => [...content.verticalFaqs, ...core.coreFaqs],
    [content.verticalFaqs, core.coreFaqs],
  );

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
            <a
              href={ctaHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-8 py-4 text-base font-semibold text-slate-950 hover:bg-emerald-400 transition"
            >
              {content.primaryCtaLabel}
            </a>
            <p className="text-xs sm:text-sm text-slate-400 max-w-xl">
              {content.trustLine}
            </p>
          </div>
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
              href={ctaHref}
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
```

---

### طريقة الاستخدام في مشروعك (سطر واحد لكل صفحة)

```tsx
import { LandingPage } from './landing/LandingPage';
import { CLINICS_VERTICAL } from './landing/data/verticals/clinics';

export function ClinicsRoute() {
  return (
    <LandingPage
      vertical={CLINICS_VERTICAL}
      initialLocale="eg"
      salesWhatsappNumber="201000000000"
    />
  );
}
```
