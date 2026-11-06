# Capability Contracts: Illustrative JSON

These are examples of future internal interfaces; none is asserted to exist in the app.

## Brand source ingestion

    POST /internal/brands/brand-demo/sources
    {
      "source_type": "spreadsheet",
      "source_locator": "secure-file-ref-123",
      "authority": "brand_catalog",
      "sync_policy": "manual",
      "locale": "ar-EG"
    }

## Retrieval

    POST /internal/agent/retrieve
    {
      "brand_id": "brand-demo",
      "question": "مقاس 42 من موديل X متاح؟",
      "intent": "product_availability",
      "source_types": ["catalog"]
    }

    {
      "evidence": [
        {
          "source_id": "catalog-1",
          "version_id": "v7",
          "chunk_id": "sku-X-42",
          "text": "Model X size 42, catalog entry",
          "location": "Products!A42:F42"
        }
      ],
      "needs_live_stock_check": true
    }

## Tool execution

    POST /internal/agent/tools/execute
    {
      "brand_id": "brand-demo",
      "workflow_id": "wf-831",
      "tool_name": "store.inventory.check",
      "input": {"sku": "X-42"},
      "idempotency_key": "wf-831-stock-X-42"
    }

The connector must return provider receipt or error evidence; only its live output can establish stock availability.

## Proactive trigger

    {
      "brand_id": "brand-demo",
      "contact_id": "customer-122",
      "reason": "quote_followup",
      "source_workflow_id": "wf-831",
      "due_at": "2026-11-08T12:00:00Z",
      "eligibility_context": {
        "channel": "meta_cloud_api",
        "consent_record_ref": "consent-77",
        "template_candidate": "quote_followup_v2"
      }
    }

The scheduler autonomously evaluates consent, timing, template availability, recent replies and duplicate suppression at send time.
