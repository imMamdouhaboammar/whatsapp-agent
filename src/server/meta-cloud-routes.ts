import type { Hono } from 'hono';
import type { MetaCloudApi } from '../transport/meta-cloud-api';

/**
 * Public Meta webhook endpoints. The caller constructs MetaCloudApi with a
 * brand-bound WABA, phone-number ID, and a durable onEvent callback before
 * registering these routes. Do not apply dashboard-cookie authentication here:
 * Meta authenticates POST with its HMAC and GET with its verify token.
 */
export type MetaCloudWebhookRouteHandler = Pick<
  MetaCloudApi, 'handleWebhookGet' | 'handleWebhookPost'
>;

export const META_CLOUD_WEBHOOK_PATH = '/webhooks/meta';

export function registerMetaCloudWebhookRoutes(
  app: Hono,
  meta: MetaCloudWebhookRouteHandler
): void {
  if (typeof meta?.handleWebhookGet !== 'function' ||
      typeof meta.handleWebhookPost !== 'function') {
    throw new TypeError('Meta webhook handler must be configured before route registration');
  }

  app.get(META_CLOUD_WEBHOOK_PATH, c => {
    try {
      return meta.handleWebhookGet(c.req.raw);
    } catch {
      return new Response('Webhook verification unavailable', { status: 503 });
    }
  });

  app.post(META_CLOUD_WEBHOOK_PATH, async c => {
    try {
      // Passing the original Request preserves the signed bytes; HMAC, size,
      // brand identity, event deduplication, and ACK rules belong to MetaCloudApi.
      return await meta.handleWebhookPost(c.req.raw);
    } catch {
      return new Response('Webhook processing unavailable', { status: 503 });
    }
  });
}
