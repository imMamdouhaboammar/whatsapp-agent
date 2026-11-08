import { describe, expect, test } from 'bun:test';
import { createFableWhatsAppAgent } from '../src/index';

describe('B2 inbound planner startup wiring', () => {
  test('enables inbound planning only for an explicitly scoped owner brand', async () => {
    const agent = await createFableWhatsAppAgent({
      dataDir: ':memory:',
      autoConnect: false,
      capabilityAutopilotBrandId: 'store',
      plannerEnv: {
        AGENT_PLANNER_INBOUND: '1',
        AGENT_PLANNER_BRAND_ID: 'store',
        AGENT_PLANNER_ALLOWED_SCOPES: 'orders:read,tickets:write',
        AGENT_PLANNER_ALLOW_WRITES: '1'
      }
    });
    try {
      expect(agent.inboundPlanner).toBeDefined();
      expect(agent.coordinator).toBeDefined();
    } finally {
      agent.inboundPlanner?.close();
      agent.burstAccumulator.destroy();
      agent.capabilities.close();
      agent.memoryStore.close();
    }
  });

  test('denies inbound planner initialization on brand mismatch', async () => {
    const agent = await createFableWhatsAppAgent({
      dataDir: ':memory:',
      autoConnect: false,
      capabilityAutopilotBrandId: 'store',
      plannerEnv: {
        AGENT_PLANNER_INBOUND: '1',
        AGENT_PLANNER_BRAND_ID: 'another-brand',
        AGENT_PLANNER_ALLOWED_SCOPES: 'orders:read',
        AGENT_PLANNER_ALLOW_WRITES: '1'
      }
    });
    try {
      expect(agent.inboundPlanner).toBeUndefined();
    } finally {
      agent.burstAccumulator.destroy();
      agent.capabilities.close();
      agent.memoryStore.close();
    }
  });
});
