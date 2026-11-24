## إزاي تمشي موضوع الـ Tailored-Made Landing Pages من غير ما تغرق في الصيانة

لو بنيت لكل مجال صفحة مستقلة من الصفر هتلاقي نفسك بتعدل 10 صفحات كل مرة تغير فيها السعر أو ميزة في المنتج، والحل العملي هنا هو معمارية **70/30 Modular Vertical Pages**

* **70% هيكل ثابت مشترك (Core Skeleton)** نفس الترتيب، نفس منطق التسعير، نفس عرض رصيد الـ 300 دولار من Google Cloud Vertex AI، ونفس الـ CTA
* **30% محتوى مخصص للمجال (Vertical Config JSON)** العنوان الرئيسي، أمثلة المحادثات الحقيقية من داخل المجال، الاعتراض الأساسي لصاحب البيزنس، والحدود التشغيلية الخاصة بالمجال
* **الروابط واللغات** مسار واضح لكل قطاع ولغة زي `/eg/clinics` و `/gcc/clinics` و `/en/clinics`، وكل صفحة بتسحب النصوص من ملف بيانات واحد
* **قاعدة التنفيذ الذهبية** ابدأ بقطاع واحد بس (العيادات مثلاً) ونزل عليه حملة صغيرة أو تواصل مباشر مع 20 عيادة، وبعد ما تظبط الرسالة وتقفل أول 3 لـ 5 عملاء Pilot انسخ الهيكل لقطاع العقارات أو المتاجر
* **نقطة حساسة في العيادات بالذات** أي صفحة للعيادات لازم توضح من بدري إن الوكيل بيتعامل مع الحجوزات والأسعار والمواعيد وتعليمات ما قبل الكشف فقط، وبيحول أي سؤال طبي أو وصف علاج للدكتور أو الفريق المختص فوراً، عشان صاحب العيادة يطمن على سمعته الطبية

---

## 1. نص صفحة العيادات — عربي (مصري)

### Hero Section

**العنوان الرئيسي**
وكيل واتساب ذكي لعيادتك يرد على المرضى ويحجز المواعيد 24 ساعة من غير اشتراكات شهرية بالآلاف

**العنوان الفرعي**
شغل التطبيق مجاناً على جهاز العيادة أو على VPS بسيط، اربطه برقم الواتساب وموديلات Google Gemini، وخلي الرد على أسعار الكشف والمواعيد وتأكيد الحجوزات شغال طول اليوم والبيانات كلها عندك

**الزر الأساسي (CTA)**
احجز مكانك في تجربة الـ Pilot

**سطر الثقة تحت الزر**
التطبيق مجاني، مع مساعدة خطوة بخطوة لتفعيل رصيد 300 دولار رسمي من Google Cloud Vertex AI للحسابات الجديدة المؤهلة

---

### واقع الرسايل في العيادة

كل يوم رسايل كتير بتوصل على واتساب العيادة بعد مواعيد الشغل أو وقت ضغط الاستقبال، والأسئلة أغلبها متكرر

* سعر الكشف كام ومواعيد الدكتور إمتى
* عنوان العيادة بالتفصيل واللوكيشن
* هل متاح حجز النهاردة أو بكرة
* إيه التحاليل أو التحضيرات المطلوبة قبل الزيارة

لما الرد يتأخر ساعة أو اتنين، المريض بيكلم عيادة تانية، ولما تفكر تشترك في منصة أتمتة واتساب بتلاقي اشتراكات شهرية غالية بالدولار، وفوقها تكاليف رسايل تسويق ومتابعة على Business API

---

### إيه اللي بيعمله الوكيل لعيادتك يومياً

* **رد فوري بلهجة مصرية طبيعية** بيجاوب على أسعار الكشف، الخدمات، مواعيد الأطباء، والعنوان في ثواني
* **تجميع بيانات الحجز** ياخد اسم المريض، رقم التليفون، التخصص، والميعاد المناسب، ويجهزهم للاستقبال
* **تذكير ومتابعة المواعيد** يبعت تعليمات ما قبل الكشف ويأكد حضور المريض قبل الميعاد عشان تقلل الغياب
* **التعامل مع الرسايل المتقطعة والفويس نوت** يفهم الرسايل الصوتية والرسايل القصيرة اللي المريض بيبعتها ورا بعض ويرد برد واحد مرتب

---

### خصوصية المرضى وحدود الرد الطبي

بيانات المرضى ومحادثاتهم بتتخزن على جهاز العيادة أو على السيرفر الخاص بيك، ومش بتروح لمنصة طرف ثالث

وكمان الوكيل بيتضبط على قواعد واضحة للعيادة، بيرد على الاستفسارات الإدارية والحجوزات والأسعار فقط، وأي سؤال طبي عن أعراض أو جرعات أو علاج بيتحول فوراً للفريق الطبي أو بيترد عليه بتوجيه المريض للحجز مع الدكتور

---

### التكلفة الحقيقية وعرض رصيد جوجل

بدل ما تدفع اشتراكات منصات بالآلاف كل شهر أو عمولات وسطاء على الرسايل، معادلة التشغيل عندك واضحة

1. **التطبيق الأساسي** مجاني بالكامل وتقدر تشغله على جهازك أو VPS رخيص
2. **تشغيل الذكاء الاصطناعي أول 90 يوم** بنساعدك رسمياً تفعل رصيد Google Cloud التجريبي بقيمة 300 دولار على Vertex AI لو حسابك جديد ومؤهل ومعاك كارت بنكي للتحقق من الهوية، وده بيغطي تشغيل موديلات Gemini بسرعة عالية خلال أول 3 شهور
3. **باقة التجهيز والمتابعة الشهرية (اختيارية)** من 300 إلى 999 جنيه شهرياً حسب حجم العيادة وعدد الرسايل، شاملة التركيب، تفعيل Vertex AI، تدريب الوكيل على ملف عيادتك، والتحديثات والدعم الفني

---

### إضافات جاية قريباً (Roadmap)

بنبني حالياً متجر إضافات جوه التطبيق عشان تركب اللي عيادتك محتاجاه بس وقت ما تحتاجه، زي الربط المباشر مع Google Sheets لجدول المواعيد، والرد بالرسايل الصوتية، والربط مع برامج إدارة العيادات

---

### أسئلة بتتكرر من أصحاب العيادات

**هل محتاج جهاز بمواصفات عالية عشان أشغله**
لأ، التطبيق خفيف وبيشتغل على جهاز عادي في العيادة أو على VPS اقتصادي

**هل رصيد الـ 300 دولار من جوجل مضمون ومدى الحياة**
الرصيد ده عرض تجريبي رسمي من Google Cloud للحسابات الجديدة المؤهلة وصلاحيته 90 يوم، وبيحتاج كارت بنكي صالح للتحقق وقت التفعيل، ودورنا إننا نجهزلك الربط بشكل سليم عشان تستفيد منه بأعلى كفاءة خلال أول 3 شهور، وبعدها بتحاسب جوجل مباشرة حسب استهلاكك الفعلي

**هل في خطورة حظر على رقم الواتساب**
الاستخدام الأساسي للرد على رسايل المرضى الواردة بضوابط سرعة طبيعية بيحافظ على أمان الرقم، وكمان التطبيق جاهز للعمل مع Meta Cloud API الرسمي للعيادات اللي بتبعت حملات ورسايل متابعة بأعداد كبيرة

---

### Final CTA

**جهز واتساب عيادتك للرد الفوري خلال أيام**
إحنا فاتحين باب الاشتراك حالياً لعدد محدود من العيادات في مرحلة الـ Pilot بأسعار الإطلاق

[اطلب تجربة Pilot لعيادتك]

---

## 2. نص صفحة العيادات والمراكز الطبية — عربي (خليجي)

### Hero Section

**العنوان الرئيسي**
وكيل واتساب ذكي لعيادتك يرد على المراجعين وينسق المواعيد على مدار الساعة بملكية كاملة لبياناتك

**العنوان الفرعي**
شغل التطبيق مجاناً على جهاز العيادة أو على خادم VPS خاص بمركزك الطبي، اربطه برقم الواتساب وموديلات Google Gemini، وتخلص من الاشتراكات الشهرية المرتفعة وتكاليف رسايل المتابعة

**الزر الأساسي (CTA)**
سجل عيادتك في المرحلة التجريبية

**سطر الثقة تحت الزر**
التطبيق مجاني بالكامل، مع مرافقة تقنية لتفعيل رصيد 300 دولار الرسمي من Google Cloud Vertex AI للحسابات الجديدة المؤهلة

---

### لماذا تضيع حجوزات العيادة على واتساب

وقت إطلاق الحملات الإعلانية أو بعد انتهاء الدوام، تتراكم استفسارات المراجعين حول أسعار الجلسات، توفر المواعيد، أسماء الأطباء، وموقع الفرع

تأخر الاستقبال في الرد يعني انتقال المراجع إلى عيادة أخرى خلال دقائق، بينما الحلول السحابية الجاهزة تفرض اشتراكات شهرية عالية وتكاليف إضافية على رسايل التسويق والمتابعة، مع بقاء محادثات مرضاك على خوادم خارجية

---

### مهام الوكيل داخل مركزك الطبي

* **رد فوري بلهجة خليجية أو عربية بيضاء طبيعية** يجيب عن الأسعار، العروض، التخصصات، ومواعيد الأطباء بدقة
* **تجهيز بيانات الحجز** يجمع اسم المراجع، رقم الجوال، الخدمة المطلوبة، والوقت المفضل لتأكيدها مباشرة من الاستقبال
* **تأكيد المواعيد وتقليل التغيب** يرسل تعليمات ما قبل الجلسة ويذكر المراجع بموعده
* **فهم الرسايل الصوتية والرسايل المتتابعة** يتعامل مع الفويس نوت والرسايل القصيرة المتفرقة ويرد بإجابة واحدة واضحة

---

### خصوصية المراجعين والانضباط الطبي

كل محادثات المراجعين وبياناتهم تبقى داخل خادم عيادتك وتحت إدارتك الكاملة، بدون مشاركتها مع منصات طرف ثالث

يعمل الوكيل وفق حدود واضحة لمركزك الطبي، فيتولى الاستفسارات الإدارية والحجوزات والأسعار فقط، ويحول أي استفسار طبي أو سؤال عن الأعراض والأدوية مباشرة إلى الطبيب المختص أو طاقم التمريض

---

### هيكل التكلفة وميزة رصيد Google Cloud

1. **التطبيق الأساسي** مجاني وتملكه بالكامل على جهازك أو خادمك الخاص
2. **رصيد Google Cloud Vertex AI بقيمة 300 دولار** ضمن خدمة الإعداد، نساعدك خطوة بخطوة على تفعيل الرصيد التجريبي الرسمي من جوجل للحسابات الجديدة المؤهلة (صالح لمدة 90 يوم ويتطلب بطاقة بنكية للتحقق)، لتشغيل موديلات Gemini بسرعة وثبات طوال فترة الإطلاق الأولى
3. **باقة التشغيل والدعم الشهري (اختيارية)** تتراوح بين 99 و300 ريال أو درهم شهرياً حسب حجم المركز، وتشمل التثبيت، ضبط ملف المعرفة الخاص بالعيادة، ربط Vertex AI، التحديثات المستمرة، والدعم الفني

---

### إضافات قادمة في خارطة الطريق (Roadmap)

نعمل حالياً على متجر إضافات مدمج داخل التطبيق يتيح لمركزك تثبيت ما يحتاجه فقط عند الحاجة، مثل الربط المباشر مع جداول Google Sheets، والردود الصوتية، والربط مع برامج إدارة العيادات

---

### الأسئلة الشائعة

**هل يتطلب التطبيق خادماً مكلفاً**
لا، يعمل بكفاءة على خادم VPS اقتصادي أو جهاز مكتبي بمواصفات أساسية داخل العيادة

**ما شروط الاستفادة من رصيد 300 دولار في Vertex AI**
الرصيد مقدم رسمياً من Google Cloud للحسابات الجديدة المؤهلة لمدة 90 يوماً ويتطلب بطاقة دفع صالحة للتحقق لدى جوجل، ونحن نجهز الربط التقني بالكامل لتستفيد منه بشكل صحيح خلال أول ثلاثة أشهر

**كيف نحمي رقم واتساب العيادة من الحظر**
التركيز على الرد على استفسارات المراجعين الواردة بوتيرة إرسال طبيعية يحافظ على استقرار الرقم، كما يدعم التطبيق الربط عبر Meta Cloud API الرسمي للمراكز التي ترسل حملات واسعة

---

### Final CTA

**فعّل الرد الفوري على واتساب عيادتك هذا الأسبوع**
المرحلة التجريبية مفتوحة حالياً لعدد محدود من العيادات والمراكز الطبية في السعودية والإمارات والخليج

[احجز جلسة الإعداد التجريبي]

---

## 3. Clinic Landing Page Copy — English

### Hero Section

**Headline**
A Self-Hosted WhatsApp AI Agent for Your Clinic That Books Patients 24/7 Without Heavy Monthly SaaS Bills

**Subheadline**
Run the core app for free on your clinic computer or a low-cost VPS, connect your WhatsApp number and Google Gemini models directly, and handle pricing, doctor schedules, and appointment inquiries around the clock while keeping full ownership of your patient conversations

**Primary CTA**
Join the Clinic Pilot

**Trust Line**
Free self-hosted core app, plus guided setup to help eligible new accounts activate Google Cloud's official $300 Vertex AI free trial credit

---

### The Daily WhatsApp Bottleneck in Clinics

Front desks get flooded during peak hours, and ad leads often message late at night asking the exact same questions

* Consultation fees and available services
* Doctor schedules and branch location
* Same-day or next-day booking slots
* Pre-visit preparation instructions

Slow replies send ready patients straight to competing clinics, while cloud chatbot platforms charge steep monthly subscriptions alongside per-message marketing and follow-up costs on Business API

---

### What Your Clinic Agent Handles Automatically

* **Instant, Natural Replies** answers questions on consultation fees, treatments, doctor hours, and clinic directions in seconds
* **Structured Booking Intake** collects the patient's name, phone number, requested service, and preferred time slot ready for your reception team
* **Appointment Reminders** sends pre-visit instructions and confirmations to reduce no-shows
* **Voice Notes and Burst Messages** transcribes patient voice notes and groups rapid-fire text messages into one clear response

---

### Patient Privacy and Strict Medical Guardrails

Every chat log and patient detail stays on your own machine or private VPS instead of sitting on a third-party SaaS cloud

The agent is configured with clear clinical boundaries, handling administrative inquiries, scheduling, and pricing only, while routing any medical questions, symptoms, or prescription requests directly to your doctors or nursing staff

---

### Transparent Cost Structure and $300 Vertex AI Setup

1. **Self-Hosted Core App** free to run on your own hardware or an entry-level VPS
2. **Official $300 Google Cloud Vertex AI Credit** during onboarding, we guide eligible new Google Cloud accounts step by step to activate Google's official 90-day $300 trial credit (requires a valid payment card for Google verification) so you can run fast Gemini models from day one
3. **Optional Monthly Care and Support Retainer** predictable local support covering installation, clinic knowledge setup, Vertex AI configuration, ongoing updates, and technical support (300 to 999 EGP/month in Egypt, 99 to 300 SAR or AED/month in the GCC)

---

### Upcoming Modular Plugins (Roadmap)

We are building an in-app plugin store so your clinic installs only the add-ons it needs as you grow, including live Google Sheets schedule sync, voice replies, and clinic management connectors

---

### Frequently Asked Questions

**Do we need an expensive server to run this**
No, the agent runs reliably on a basic office PC or a low-cost VPS

**Is the $300 Vertex AI credit permanent**
It is an official 90-day free trial provided by Google Cloud for eligible new accounts with a valid verification card, and our team sets up the integration cleanly so your clinic gets full value during its first three months before standard pay-as-you-go Google billing applies

**How do you protect our clinic's WhatsApp number**
Handling inbound patient inquiries with natural reply pacing keeps everyday operations safe, and the codebase also supports the official Meta Cloud API for clinics running high-volume outbound campaigns

---

### Final CTA

**Put Your Clinic's WhatsApp on Instant Response**
We are onboarding a small group of clinics into our early Pilot program with dedicated setup and launch pricing

[Request Your Clinic Pilot Slot]

---

تحب نعمل دلوقتي ملف الـ JSON بتاع الـ 30% المتغيرة دي عشان تبني الصفحة في React أو Astro بسرعة وتقدر تبدل بين العيادات والعقارات والمتاجر من نفس الكود، ولا نكتب النص التاني لمجال مختلف زي المتاجر الإلكترونية أو العقارات؟
