# Marketing Strategy — WhatsApp AI Agent
**Head of Growth, Positioning & Marketing Strategy**
*Egypt & GCC Markets | Last Updated: November 2026*

---

> [!IMPORTANT]
> This document is the single source of truth for all positioning, copy, campaigns, and funnel decisions. Every asset produced must reference a section here. Never ship copy that hasn't been validated against the **Honesty Guardrails** in Section 4.

---

## TABLE OF CONTENTS

1. [Strategic Overview](#1-strategic-overview)
2. [Positioning Anchor & Competitive Framing](#2-positioning-anchor--competitive-framing)
3. [Business Model & Unit Economics](#3-business-model--unit-economics)
4. [Target Markets & Buyer Personas](#4-target-markets--buyer-personas)
5. [Messaging Framework](#5-messaging-framework)
6. [Launch Phases & Campaign Roadmap](#6-launch-phases--campaign-roadmap)
7. [Landing Page Architecture](#7-landing-page-architecture)
8. [Social Content Playbook](#8-social-content-playbook)
9. [Conversion Funnels](#9-conversion-funnels)
10. [Pricing Experiments](#10-pricing-experiments)
11. [Objection Handling Bank](#11-objection-handling-bank)
12. [Honesty Guardrails Reference](#12-honesty-guardrails-reference)
13. [Open Hypotheses & Testing Queue](#13-open-hypotheses--testing-queue)

---

## 1. STRATEGIC OVERVIEW

### Product-in-One-Line
A self-hosted WhatsApp AI Agent that lets businesses in Egypt and the GCC run a 24/7 AI sales assistant on their own machine or cheap VPS — connected directly to their WhatsApp number and Google Gemini — without paying per-message marketing fees or high SaaS subscriptions.

### Why This Moment
- WhatsApp remains the dominant sales channel across Egypt and the GCC, used to close deals for e-commerce, clinics, real estate, education, and local services.
- Meta's Business API fees and third-party chatbot platform pricing ($50–$500+/month) are creating real cost pain as ad budgets get squeezed.
- Google Cloud's official $300 Vertex AI free trial gives an eligible new user a production-grade AI engine at zero AI cost during the critical first 90 days — this is a concrete, honest acquisition advantage.
- Self-hosting is no longer exotic: a $5–$10/month VPS (DigitalOcean, Hetzner, Contabo) handles this workload, and many Egypt-based business owners already use VPS for other tools.

### Current Product Stage
> [!WARNING]
> The product is in **early development and active building**. The Plugin Marketplace is **not yet shipped**. Only sell and demo what is live today.

| What is Live Today ✅ | Roadmap / Waitlist Only 🔜 |
|---|---|
| Self-hosted WhatsApp AI Agent (core) | In-app Plugin Marketplace |
| Gemini / Vertex AI integration | One-click e-commerce connectors (Salla, Zid, Shopify) |
| Brand knowledge & persona setup | Google Sheets inventory sync |
| Automated customer replies & sales conversations | Advanced voice reply skills |
| $300 Vertex AI onboarding assistance | Advanced analytics dashboard |
| Monthly care/support retainer | CRM connectors |

---

## 2. POSITIONING ANCHOR & COMPETITIVE FRAMING

### The Core Problem (Primary Positioning)
Businesses paying for WhatsApp sales today face two compounding costs:

1. **Meta API & BSP Outbound Fees** — Marketing messages, utility follow-ups, and campaign broadcasts sent via the official WhatsApp Business API carry per-message fees plus BSP (Business Solution Provider) markup. Rigid template pre-approvals slow down campaign execution.
2. **SaaS Platform Subscriptions** — Third-party WhatsApp AI platforms charge high fixed monthly fees just to layer an AI response system on top of WhatsApp — often thousands of EGP or hundreds of SAR monthly — while keeping all data in their cloud.

> [!NOTE]
> **Accuracy boundary:** Do not claim Meta charges per message on every basic inbound reply in a 24-hour service window. The specific costs to emphasize accurately are: outbound marketing/utility message fees, BSP markups, template restrictions, and high SaaS subscription fees from third-party platforms.

### Our Position in One Statement
> *"Own your WhatsApp AI Agent. Run it on your own machine, connect your own number and Gemini key, and stop paying per-message markups or inflated monthly SaaS fees for an AI that replies, qualifies, and sells for you 24/7."*

### Competitive Landscape Summary

| Competitor Type | Pain Point We Solve |
|---|---|
| Meta WhatsApp Business API (direct) | Per-message marketing fees, template rigidity, BSP markups |
| SaaS chatbot platforms (e.g., Tidio, Respond.io, Twilio) | High monthly subscriptions, data stored on their servers, USD pricing friction |
| Generic AI tools (ChatGPT wrappers, Zapier automations) | No deep WhatsApp integration, no brand knowledge, no sales context |
| Human WhatsApp operators | No coverage at 2am, slow response, inconsistent messaging, salary overhead |

### Honest Differentiation (Don't Fabricate, These Are Real)
- **Full data ownership** — conversations, customer data, and brand knowledge stay on the client's own machine or VPS.
- **No per-message billing** — the AI replies as many times as needed once the system is running.
- **$300 Vertex AI credit legitimacy** — Google Cloud officially provides this for new eligible accounts. We provide the setup guidance to ensure clients actually activate and benefit from it.
- **Modular by design** — the plugin architecture means clients pay for capabilities they need, not a bloated all-in-one platform.

---

## 3. BUSINESS MODEL & UNIT ECONOMICS

### Three Revenue Layers

#### Layer 1 — Free Core (Acquisition Engine)
- **What:** Self-hosted WhatsApp AI Agent base application
- **Goal:** Remove friction, drive GitHub stars/installs, build community trust, collect qualified leads for Layers 2 and 3
- **Marketing role:** Top-of-funnel. Convert to Layer 2 through demonstrated value and care needs.

#### Layer 2 — Monthly Care & Support Retainer (Recurring Revenue) ⚠️ HYPOTHESIS

> [!NOTE]
> Pricing tiers below are **unvalidated hypotheses**. Test before committing to public positioning.

| Market | Monthly Range | What It Covers |
|---|---|---|
| Egypt | 300 – 999 EGP/month | Stability, updates, monitoring, Vertex AI setup support, direct technical support |
| GCC (KSA, UAE, Gulf) | 99 – 300 SAR/AED/month | Same as above, priority response, Gulf Arabic tone tuning |

**Positioning Angle — Not "IT Maintenance":**
Frame this around business continuity and revenue protection, not technical services:
- *"Your AI agent runs your WhatsApp sales channel. If something breaks at peak campaign time, you need it back up fast."*
- *"Updates, monitoring, and onboarding help included — so you focus on orders, not on debugging servers."*

**⚠️ Unit Economics Flag:**
If Egypt clients at 300 EGP/month require more than ~1–2 hours of active support monthly, the tier becomes unprofitable at current margins. Recommend testing the minimum viable support load before scaling this tier publicly. Consider a tiered structure (self-serve vs. managed) if support demand is high.

#### Layer 3 — Plugin & Skills Marketplace (Expansion Revenue) 🔜 ROADMAP

- Priced per plugin based on business value delivered.
- Announced as direction, never sold as available today.
- Use it to attract early adopters who want to shape which plugins get built first.

---

## 4. TARGET MARKETS & BUYER PERSONAS

### Market A — Egypt

**Macro Context:**
- WhatsApp is the primary sales closing channel for small and medium businesses.
- Strong resistance to USD-denominated SaaS fees (exchange rate pressure, card friction).
- Growing VPS familiarity among tech-adjacent operators, but still scary for the average business owner.
- Gemini API billing via USD card is a real friction point requiring a workaround story.

**Primary Personas:**

#### Persona EG-1: The E-Commerce Owner
- Runs a Salla/Shopify/Instagram shop doing 50–300 orders/month
- Handles WhatsApp inquiries manually or via a customer service person
- Pain: inquiries arrive at night, response time is slow, human CS is inconsistent and expensive
- Objection: "Will this get my number banned?" / "How do I set this up — I'm not technical"
- CTA: **Beta pilot / Paid setup + retainer**

#### Persona EG-2: The Clinic / Health Services Operator
- Books appointments and answers patient questions via WhatsApp
- Pain: spends hours daily responding to repetitive questions (prices, timings, availability)
- Objection: "Patient data safety — where does it go?" / "What if it gives wrong medical info?"
- CTA: **Demo call → Retainer**

#### Persona EG-3: The Technical Operator / Freelancer
- Builds tools for clients, early adopter of AI products
- Pain: tired of paying SaaS platforms for clients, wants a white-label or agency model
- Objection: "Is the codebase stable enough to build on?"
- CTA: **GitHub star → Waitlist → Agency/Reseller discussion**

---

### Market B — GCC (KSA, UAE, Qatar, Kuwait)

**Macro Context:**
- Higher willingness to pay for speed, reliability, and data privacy.
- Preference for Gulf/White Arabic with accurate cultural tone (formal vs. casual by context).
- Peak ad spend during Ramadan, National Day campaigns, and seasonal sales creates acute demand for reliable 24/7 response handling.
- Regional commerce platforms (Salla, Zid) are dominant; integrations are a purchase driver.

**Primary Personas:**

#### Persona GCC-1: The Regional Brand Manager
- Runs paid campaigns on Meta/TikTok; WhatsApp handles post-click inquiries
- Pain: ad spend drives traffic but human agents can't handle the volume spike
- Objection: "I need to be sure the Arabic is accurate and the brand voice is consistent"
- CTA: **Pilot during next campaign → Retainer**

#### Persona GCC-2: The E-Commerce Operator (Salla/Zid)
- Processes orders and answers product questions on WhatsApp
- Pain: paying high SaaS fees for a chatbot layer that doesn't integrate well with Salla/Zid
- Objection: "Will this work with my Salla store?" → Honest answer: Salla/Zid connector is **roadmap**
- CTA: **Waitlist for Salla/Zid plugin → Retainer now for base agent**

#### Persona GCC-3: The Privacy-Conscious Operator
- Runs a business with customer data sensitivity (legal, medical, financial)
- Pain: doesn't want customer conversations stored on a third-party US cloud
- Objection: "Where does the data actually live?"
- CTA: **Demo showing self-hosted data ownership → Retainer**

---

## 5. MESSAGING FRAMEWORK

### Master Message Architecture

```
LAYER 1 — What it is (factual anchor)
  Your own WhatsApp AI Agent, running on your machine or VPS.
  Connected to your number, your Gemini key, your brand knowledge.

LAYER 2 — Why it matters (cost and control)
  Stop paying per-message fees for outbound campaigns.
  Stop renting AI replies at high monthly SaaS rates.
  Your data stays with you.

LAYER 3 — Proof point (concrete scenario)
  [Egypt] رد فوري على 50 عميل بيسألوا عن السعر والمقاسات الساعة 2 بالليل
           على سيرفر بـ 5 دولار في الشهر، وكريدت Google بـ 300 دولار يغطي
           الـ AI لأول 90 يوم.

  [GCC]   وكيل واتساب يرد على استفسارات حملتك في الرمضان خلال ثوانٍ،
          بالعربية الخليجية الدقيقة، من سيرفرك أنت — مش من سحابة أحد ثاني.

LAYER 4 — CTA (single, specific action)
  [Early access] → Join the beta waitlist
  [Ready now] → Book a setup call
  [Technical] → Star the repo on GitHub
```

---

### Egypt Copywriting Examples

**Ad Hook — E-Commerce:**
> عندك متجر وعندك زبائن بيكتبوا على الواتساب كل الوقت؟
> وكيل AI بيرد عليهم بأسلوبك وبمعلومات متجرك — 24/7.
> شغّاله على سيرفر بـ 5 دولار في الشهر، وأول 90 يوم بكريدت Google رسمي بـ 300 دولار.
> **[احجز جلسة إعداد]**

**Ad Hook — Clinic:**
> المرضى بيسألوا عن المواعيد والأسعار والساعات الساعة 11 بالليل.
> وكيل AI بيرد عليهم فوراً بمعلوماتك الصح — من غير ما تستأجر موظف CS.
> **[اعرف أكتر]**

**Pain Agitator — SaaS Cost:**
> المنصات اللي بتديك AI على الواتساب بتاخد منك 300–1500 جنيه في الشهر
> مقابل إيه بالظبط؟ إنهم يحطوا الـ AI على واتساب بدلك؟
> شغّل الوكيل ده على جهازك أو على سيرفر رخيص. البيانات عندك. الرد فوري.
> **[جرّب مجاناً]**

---

### GCC Copywriting Examples

**Ad Hook — Brand Manager:**
> حملتك تشتغل. الإعلانات تجيب استفسارات. والوكيل يرد في ثوانٍ
> بالعربية الصحيحة وأسلوب علامتك — من سيرفرك أنت.
> بيانات عملائك ما تخرج من عندك.
> **[ابدأ تجربة مجانية]**

**Pain Agitator — SaaS:**
> تدفع مئات الريالات كل شهر لمنصة تحط AI على واتساب بدلك؟
> شغّل وكيلك أنت. البيانات ملكك. الرد في ثوانٍ. التكلفة الثابتة بس.
> **[اعرف كيف]**

---

## 6. LAUNCH PHASES & CAMPAIGN ROADMAP

### Phase 0 — Foundation (Now → Launch)
**Goal:** Build the minimum credibility infrastructure before any public campaign.

| Task | Owner | Status |
|---|---|---|
| GitHub repo live with README, screenshots, demo GIF | Engineering | ☐ |
| Landing page live (Egypt Arabic + GCC Arabic versions) | Marketing | ☐ |
| Beta waitlist form (Typeform/Tally) active | Marketing | ☐ |
| Demo video (screen recording, real conversation, 60–90 sec) | Founder | ☐ |
| Pricing page draft (retainer tiers, honest labels) | Founder | ☐ |

---

### Phase 1 — Technical Community & Early Adopters (Launch Month 1)
**Goal:** 100 GitHub stars, 20 qualified beta waitlist signups (Egypt + GCC)

**Channels:**
- **GitHub README** → Optimize for technical operators (Persona EG-3, GCC-3)
- **Twitter/X Arabic tech community** → Founder personal account, behind-the-build content
- **LinkedIn** → Targeted at digital marketing managers, e-commerce operators (Gulf)
- **Facebook Groups** → Egypt e-commerce groups, tech startup communities
- **WhatsApp Groups** → Warm personal network, Persona EG-1 and EG-2

**Content Themes:**
1. *Build-in-public:* "بنبني وكيل واتساب AI خاص للشركات المصرية والخليجية — شوف كيف"
2. *Demo clip:* Real WhatsApp conversation handled by the agent (product screenshot + caption)
3. *Cost breakdown:* Real numbers — VPS cost + Vertex AI credit + retainer vs. SaaS alternative
4. *Technical post:* How the Gemini + Baileys integration works (for Persona EG-3)

**CTA for Phase 1:** GitHub star + Beta Waitlist signup

---

### Phase 2 — Paid Acquisition Tests (Month 2–3)
**Goal:** Validate CPA per qualified lead for Egypt and GCC separately

> [!CAUTION]
> Do not scale paid spend until at least 10 paying retainer clients have onboarded and support load is understood. Premature paid scale at cheap retainer price points with high support overhead destroys margin.

**Egypt — Meta Ads Test:**
- Audience: Small business owners, e-commerce operators, clinic managers, 25–45
- Creative format: Short video (problem/solution) + before/after WhatsApp reply speed
- Budget: 500–1,000 EGP test budget
- CTA: Beta waitlist → Setup call

**GCC — LinkedIn + Meta Ads Test:**
- Audience: Marketing managers, e-commerce directors, Saudi/UAE business owners
- Creative format: Text-heavy problem statement + cost comparison
- Budget: 500 SAR test budget
- CTA: Demo call → Retainer

---

### Phase 3 — Retainer Conversion & Plugin Waitlist (Month 3–6)
**Goal:** 20 paying monthly retainer clients, Plugin Marketplace waitlist open

**Key Activities:**
- Case study from first 3 paying clients (with permission, specific metrics)
- Plugin Marketplace waitlist page → collect votes on which plugins to build first
- Referral / affiliate program design for Persona EG-3 (freelancers who install for clients)

---

## 7. LANDING PAGE ARCHITECTURE

### Egypt Version (Arabic RTL)

**Above the Fold:**
```
[Headline] وكيل واتساب AI شغّاله على سيرفرك أنت
[Sub]      يرد على زبائنك 24/7 بأسلوبك وبمعلومات متجرك — من غير ما تدفع
           اشتراك شهري مبالغ فيه لأي حد تاني.
[CTA]      [احجز جلسة إعداد] [اعرف أكتر]
[Trust]    بيانات عندك. رد فوري. كريدت Google رسمي بـ 300 دولار للأول 90 يوم.
```

**Section 2 — The Real Cost (Pain)**
> معظم الأدوات اللي بتدير محادثات الواتساب بـ AI بتاخد منك 300–2000 جنيه في الشهر —
> وبعدين بيبعتولك فاتورة على كل رسالة تسويقية بتبعتها.
> دي بيانات زبايينك بتتحفظ على سيرفر مش سيرفرك.

**Section 3 — How It Works (Mechanism)**
1. شغّل الأبليكيشن على لابتوبك أو على سيرفر رخيص (5–10 دولار/شهر)
2. ربط رقم الواتساب بتاعك مباشرةً
3. أضف معلومات بيزنسك — المنتجات، الأسعار، أسلوب الرد
4. فعّل كريدت Google Vertex AI الرسمي بـ 300 دولار (بنساعدك خطوة بخطوة)
5. الوكيل يرد، يتابع، ويبيع — 24/7

**Section 4 — Proof / Demo**
- Screen-recorded demo of a real conversation
- Numbers: response time, concurrent conversations handled, cost per month

**Section 5 — Pricing**
- Free core app (clear: self-managed)
- Retainer plans (Egypt range, honest labels: *"تحت الاختبار — سعر مبدئي"*)
- Plugin Marketplace → Coming Soon / Waitlist

**Section 6 — Objections**
- "هيتبن رقمي؟" → Honest answer
- "أنا مش تقني" → Retainer covers setup
- "البيانات فين؟" → On your server, not ours

**CTA Footer:** احجز جلسة إعداد مجانية الأسبوع ده

---

### GCC Version (White Arabic)

**Above the Fold:**
```
[Headline] وكيل واتساب بالذكاء الاصطناعي، يعمل على سيرفرك أنت
[Sub]      يرد على استفسارات عملائك في ثوانٍ، بالعربية الدقيقة،
           ٢٤ ساعة — بدون اشتراكات شهرية مرتفعة لمنصات خارجية.
[CTA]      [احجز عرضاً توضيحياً] [ابدأ التجربة المجانية]
```

**Key Sections:**
1. مشكلة التكلفة (Cost problem — specific SAR/AED numbers)
2. كيف يعمل (Mechanism — same 5 steps, Gulf Arabic)
3. ملكية البيانات (Data ownership — key GCC differentiator)
4. الموثوقية في أوقات الذروة (Reliability during Ramadan/National Day campaigns)
5. التسعير (Retainer ranges, honest labels)
6. الإضافات القادمة (Salla/Zid plugins → Waitlist)

---

## 8. SOCIAL CONTENT PLAYBOOK

### Content Pillars

| Pillar | Frequency | Purpose |
|---|---|---|
| **Build-in-Public** | 2x/week | Trust + community |
| **Cost Breakdown Posts** | 1x/week | Direct pain agitation |
| **Demo Clips** | 1x/week | Proof |
| **Customer Stories** (once available) | 1x/month | Social proof |
| **Education** (WhatsApp best practices) | 1x/week | Authority |
| **Objection Handling** | 2x/week | Conversion |

---

### Sample Posts

**Egypt — Facebook/Instagram (Cost Breakdown)**
```
💡 حساب سريع:

منصة واتساب AI جاهزة: 400–1,500 جنيه في الشهر
+ رسوم على الرسائل التسويقية: بتزيد مع كل حملة

الوكيل ده:
✅ شغّاله على سيرفر بـ 150 جنيه في الشهر
✅ أول 90 يوم بكريدت Google رسمي بـ 300 دولار
✅ بيانات الزبائن عندك مش على سيرفرات تانية
✅ بيرد على أي عدد محادثات في وقت واحد

الفرق مش في الـ AI — الفرق في مين بيمتلك الأداة.

[رابط في البايو]
```

**GCC — LinkedIn (Data Privacy Angle)**
```
كل محادثة عميلك على واتساب مع وكيلك الذكي —
تعرف أين تُخزَّن بياناتها؟

في معظم منصات واتساب AI: على سيرفرات المنصة.
ليس سيرفرك. ليس في دولتك. ليس تحت سيطرتك.

الوكيل الذي نبنيه يعمل على سيرفرك أنت.
البيانات ملكك. الوصول ملكك. التحكم ملكك.

إذا كانت خصوصية بيانات عملائك مهمة لعملك —
هذا الفرق يستحق التفكير.

[رابط في التعليقات]
```

**Twitter/X — Build in Public**
```
Day 23 building a self-hosted WhatsApp AI Agent for Egypt & GCC SMBs.

Today: got the Vertex AI $300 credit activation flow working end-to-end.

Most businesses leave this on the table because setup is confusing.
We've now documented every step so our users don't.

GitHub ↓ [link]
```

---

## 9. CONVERSION FUNNELS

### Funnel A — Technical Operator (Persona EG-3 / GCC-3)

```
Twitter/X post or GitHub discovery
    ↓
GitHub README (clear install instructions, demo GIF)
    ↓
GitHub Star + Follow founder account
    ↓
Newsletter / Telegram community invite
    ↓
Agency/Reseller conversation (manual, 1:1)
```

**CTA:** Star → Community → Reseller discussion

---

### Funnel B — Non-Technical Business Owner — Egypt (Persona EG-1, EG-2)

```
Facebook/Instagram Ad or Group post
    ↓
Landing Page (Arabic, mobile-first)
    ↓
Beta Waitlist signup (name, WhatsApp, business type)
    ↓
Personal WhatsApp outreach by founder (qualify + demo offer)
    ↓
Setup call → Paid retainer close
```

**CTA:** Ad → Waitlist → WhatsApp call → Retainer

---

### Funnel C — GCC Business Owner (Persona GCC-1, GCC-2)

```
LinkedIn post or Meta Ad
    ↓
Landing Page (Gulf Arabic, desktop-optimized)
    ↓
"Book a demo" CTA → Calendly
    ↓
30-min video demo → Objection handling
    ↓
Retainer proposal (PDF) → Close
```

**CTA:** Ad → Demo booking → Retainer

---

### Funnel D — Plugin Marketplace Early Adopter

```
Any content (social, GitHub, landing page)
    ↓
Plugin Waitlist page (vote on which plugins to build first)
    ↓
Email nurture (product updates, build-in-public)
    ↓
Plugin launch day purchase
```

**CTA:** Waitlist → Email list → Plugin purchase

---

## 10. PRICING EXPERIMENTS

> [!WARNING]
> All price points below are **unvalidated hypotheses**. Run structured tests before scaling.

### Egypt Retainer — Test Matrix

| Tier | Price | What's Included | Hypothesis |
|---|---|---|---|
| Starter | 300 EGP/month | Setup guide, async support (email/WhatsApp), updates | Low-touch, tests price sensitivity |
| Managed | 600 EGP/month | Same + proactive monitoring, 1 monthly check-in call | Tests willingness to pay for human contact |
| Priority | 999 EGP/month | Same + priority response (<4hr), Vertex AI setup included | Tests high-touch demand |

**Testing Method:** Offer all three tiers to first 20 leads, observe where they anchor. Do not scale ads until conversion rate and support cost per tier is understood.

### GCC Retainer — Test Matrix

| Tier | Price | Hypothesis |
|---|---|---|
| Standard | 99 SAR/AED/month | Minimum viable, tests if GCC will pay for self-hosted support |
| Professional | 199 SAR/AED/month | Mid-tier with faster response SLA |
| Enterprise | 300 SAR/AED/month | For brand managers needing campaign-time reliability guarantees |

### Plugin Pricing Hypotheses (Roadmap Only)
- Salla/Zid connector: 99–149 SAR/month (recurring, high business value)
- Google Sheets inventory sync: 49–79 EGP/month
- Advanced sales funnel skill: 199–299 EGP/month or 79–99 SAR/month

---

## 11. OBJECTION HANDLING BANK

### Egypt Objections

| Objection | Honest Answer |
|---|---|
| "هيتبن رقمي؟" | الوكيل شغّال على اتصال غير رسمي بالواتساب — زي ما بيستخدم المبرمجين. الخطر موجود لو استخدمته في رسائل سبام أو إرسال جماعي مش مطلوب. للردود على الزبائن اللي كتبوا أولاً، خطر البان منخفض جداً. لو محتاج ضمان كامل، في مستقبلاً خيار الربط بـ Meta Cloud API الرسمي. |
| "أنا مش تقني" | الباكيج المدفوع بيشمل الإعداد الكامل من أولو لآخره — VPS، الوكيل، والـ Vertex AI. مش محتاج تعرف حاجة. |
| "الكريدت بـ 300 دولار — ده لازم كارت دولار؟" | أيوه، Google بتطلب كارت بنكي للتحقق. في خيارات متعددة: Wise، كارت Noor، الكارت الدولي من البنوك المصرية. بنساعدك تاخد الخطوات الصح. |
| "ممكن يغلط ويبعت معلومات غلط؟" | الوكيل بيشتغل على المعلومات اللي انت حطّها. اللي ما حطّتوش، الوكيل ما برد عليه أو بيوضح إنه مش متأكد. الـ hallucination محدودة لأن المعلومات من قاعدتك أنت. |

### GCC Objections

| Objection | Honest Answer |
|---|---|
| "هل هذا موثوق أثناء حملات الذروة؟" | يعتمد على مواصفات السيرفر. سيرفر بـ 20–40 دولار شهرياً يتحمل مئات المحادثات المتزامنة. ضمن الباكيج المدفوع، نساعدك تختار المواصفات الصحيحة حسب حجم حملتك. |
| "هل يدعم متجر Salla أو Zid؟" | التكامل المباشر مع Salla/Zid قيد التطوير وسيكون من أوائل الإضافات. حالياً يمكن تزويد الوكيل بمعلومات المنتجات يدوياً أو عبر Google Sheets. |
| "بيانات عملائي فين بالضبط؟" | على السيرفر الذي تختاره أنت. لا نخزن أي محادثات على خوادمنا. |
| "لماذا لا أستخدم منصة معروفة؟" | المنصات المعروفة تضع بياناتك على سيرفراتها وتفرض اشتراكات شهرية ثابتة بغض النظر عن الاستخدام. هذا الوكيل يعمل على مواردك أنت، وتتحكم في كل شيء. |

---

## 12. HONESTY GUARDRAILS REFERENCE

> [!CAUTION]
> Any copy that violates the rules below must be rewritten before publishing.

### What We Never Say
- ❌ "100% ban-proof" or any guarantee against WhatsApp number banning on unofficial connections
- ❌ "Meta charges you for every single message" (inaccurate — only specific message types carry fees)
- ❌ "We give you $300 Google credits" (inaccurate — Google gives eligible new accounts this credit; we provide setup help)
- ❌ "The Plugin Marketplace is live" or "Install our Salla connector today" (not shipped yet)
- ❌ Any denial-then-reveal contrast slogan ("ده مش X, دي Y" / "this is not X, it is Y")
- ❌ Hollow buzzwords: revolutionary, game-changing, cutting-edge, seamless, effortless, next-generation, unleash, unlock, empower, disrupt, synergy, world-class
- ❌ Overused Arabic AI clichés: "فخ", "مكنة", "وجع"

### What We Always Say Accurately
- ✅ "$300 Google Cloud Vertex AI free trial for eligible new accounts (90 days, requires payment card for verification) — we guide your activation"
- ✅ "Outbound marketing and utility message fees on Meta's API" (not all messages)
- ✅ "Plugin Marketplace is on the roadmap — join the waitlist to shape which plugins we build first"
- ✅ "Unofficial WhatsApp connections carry ban risk if used for spam or aggressive cold outreach"
- ✅ Price ranges labeled as "tentative / under testing" until validated

---

## 13. OPEN HYPOTHESES & TESTING QUEUE

> Items marked 🔴 are blocking decisions. Items marked 🟡 are important but non-blocking. Items marked 🟢 are low-priority.

| # | Hypothesis | How to Test | Status |
|---|---|---|---|
| H1 🔴 | Egypt business owners will pay 300–600 EGP/month for a managed retainer | Offer to first 20 qualified leads, track close rate | ☐ Untested |
| H2 🔴 | GCC operators will pay 99–199 SAR/month for a standard retainer | Same approach via LinkedIn/demo flow | ☐ Untested |
| H3 🟡 | The $300 Vertex AI credit is a meaningful acquisition hook | A/B test landing page with and without this feature highlighted | ☐ Untested |
| H4 🟡 | Persona EG-3 (technical freelancer) is a viable channel-builder/reseller | Manual 1:1 conversations with 10 technical operators | ☐ Untested |
| H5 🟡 | Facebook Groups are a cost-effective Egypt lead source | Run 5 posts in relevant groups, track form submissions | ☐ Untested |
| H6 🟡 | LinkedIn is a viable GCC lead source for Persona GCC-1 | 2-week organic posting test, track profile visits and DMs | ☐ Untested |
| H7 🟢 | Salla/Zid plugin waitlist drives meaningful GCC email list growth | Add waitlist section to landing page, track signups | ☐ Untested |
| H8 🟢 | Build-in-public content on Twitter/X builds meaningful GitHub star velocity | 4-week consistent posting, track stars/week | ☐ Untested |

---

## CHANGELOG

| Date | Change | Author |
|---|---|---|
| Nov 2026 | Initial document created | Head of Growth |

---

*This document is a living strategy. Update it as hypotheses are tested, pricing is validated, and new market signals emerge. Never publish copy without tracing it back to a section here.*
