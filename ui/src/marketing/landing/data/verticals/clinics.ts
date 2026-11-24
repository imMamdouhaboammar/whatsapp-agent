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
