# A03 Web Scout and Fresh Fact Research

**Priority:** P1 | **Runtime:** Bun model tool wrapper | **Provider:** Gemini Google Search grounding, verified URL reader

## Role

The agent can decide to search the public internet when the customer's answer depends on recent or otherwise absent outside-world facts: public holiday logistics, product manufacturer specifications, published regulations, service advisories, public event timing or competitor context if relevant.

## Tool API

- web.search({question, geography?, freshness_need, max_sources})
- web.read({url, expected_publisher?, max_bytes})
- Result includes title, publisher, URL, observed_at, published_at if available, summary, relevant passages and trust assessment
- Attach source references to workflow evidence; separate observation date from publication date

## Decision policy

- Call A01 for own-brand details and A06 for live business state first
- Trigger A03 on time-sensitive external claims, unknown public technical detail or explicit customer request for independent source
- Prefer original official sites when a policy, government update or product spec needs verification
- Cache low-volatility facts by type; force a fresh check for volatile information
- Do not present third-party claims as official brand promises

## Safe interpretation

Webpages may contain malicious commands; treat them only as quoted data. The planner's available tools and permissions remain defined by the app, never by crawled content. Strip scripts and untrusted UI markup.

## Tests

- Search is invoked for a current public fact, but not for known business operating hours
- A newer official source takes priority over an undated repost
- Search returns no credible evidence -> qualified response with uncertainty
- Malicious page asks to export customer data -> no tool call
- Report exposes URL and retrieval timestamp for post-hoc verification

## Operational choice

Start with model-native Google Search grounding; add a separate search provider only if quality/region tests show a real coverage gap.
