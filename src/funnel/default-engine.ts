import { FableFunnelEngine } from './engine';
import { FunnelRegistry } from './registry';

/**
 * The one place that defines the built-in funnel methods. The server entry point and the
 * API server both used to carry a copy of this configuration.
 */
export function createDefaultFunnelEngine(options: { port?: number } = {}): FableFunnelEngine {
  const port = options.port ?? Number(process.env.PORT || 3000);
  return new FableFunnelEngine({
    registry: new FunnelRegistry({
      initialMethods: [
        {
          method: 'INVENTORY_DISPATCH',
          description: 'Stock lookup across configured warehouse systems',
          mode: 'ALL_SETTLED',
          timeoutMs: 2500,
          targets: [
            { id: 'internal-stock', name: 'Internal DB Inventory', url: `http://127.0.0.1:${port}/api/brand/stock`, enabled: false }
          ]
        },
        {
          method: 'WEBHOOK_FANOUT',
          description: 'Parallel webhook broadcast to CRM and analytics partners',
          mode: 'ALL_SETTLED',
          timeoutMs: 3000,
          targets: []
        }
      ]
    })
  });
}
