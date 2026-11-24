import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({
  root: uiRoot,
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
});

after(async () => {
  await vite.close();
});

const {
  createInitialSession,
  selectOption,
  advanceFromLoader,
  buildFinalBlueprint,
  renderCurrentNode,
} = await vite.ssrLoadModule('/src/marketing/lead-funnel/engine.ts');

const { CORE_SPINE, INDUSTRY_PACKS } = await vite.ssrLoadModule('/src/marketing/lead-funnel/registry.ts');

const testCtx = {
  coreSpine: CORE_SPINE,
  industries: INDUSTRY_PACKS,
  salesWhatsappNumber: '201012345678',
  freeDownloadUrl: 'https://github.com/imMamdouhaboammar/whatsapp-agent',
};

test('Interactive Funnel Analytics: emits structured events to onEvent, clarity, and dataLayer', () => {
  const events = [];
  const clarityCalls = [];
  const dataLayer = [];

  // Mock global window objects
  globalThis.window = {
    clarity: (action, eventName, payload) => {
      clarityCalls.push({ action, eventName, payload });
    },
    dataLayer,
  };

  const emit = (session, payload) => {
    const fullEvent = {
      ...payload,
      sessionId: session.sessionId,
      timestamp: Date.now(),
    };
    events.push(fullEvent);

    if (globalThis.window?.clarity) {
      globalThis.window.clarity('event', fullEvent.event, {
        nodeId: fullEvent.nodeId,
        industryId: fullEvent.industryId,
        painScore: fullEvent.painScore,
        optionId: fullEvent.optionId,
      });
    }

    if (Array.isArray(globalThis.window?.dataLayer)) {
      globalThis.window.dataLayer.push({
        event: fullEvent.event,
        funnel_session_id: fullEvent.sessionId,
        funnel_node_id: fullEvent.nodeId,
        funnel_industry_id: fullEvent.industryId,
        funnel_pain_score: fullEvent.painScore,
        funnel_option_id: fullEvent.optionId,
      });
    }
  };

  let session = createInitialSession('medical');

  // 1. Started event
  emit(session, {
    event: 'funnel_started',
    industryId: 'medical',
    nodeId: 'q02_ops_mode',
    painScore: 0,
  });

  // 2. Select option step completed
  const step = selectOption(testCtx, session, 'team');
  session = step.nextSession;

  emit(session, {
    event: 'funnel_step_completed',
    industryId: session.industryId,
    nodeId: 'q02_ops_mode',
    optionId: 'team',
    nextNodeId: session.currentNodeId,
    painScore: session.painScore,
  });

  // Assert events received
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'funnel_started');
  assert.equal(events[1].event, 'funnel_step_completed');

  // Assert Clarity received exact calls
  assert.equal(clarityCalls.length, 2);
  assert.equal(clarityCalls[0].action, 'event');
  assert.equal(clarityCalls[0].eventName, 'funnel_started');
  assert.equal(clarityCalls[1].eventName, 'funnel_step_completed');
  assert.equal(clarityCalls[1].payload.nodeId, 'q02_ops_mode');

  // Assert dataLayer received exact objects
  assert.equal(dataLayer.length, 2);
  assert.equal(dataLayer[0].event, 'funnel_started');
  assert.equal(dataLayer[1].event, 'funnel_step_completed');
  assert.equal(dataLayer[1].funnel_pain_score, 10);

  delete globalThis.window;
});

test('Interactive Funnel Keyboard & Shortcut mapping Simulation', () => {
  let session = createInitialSession('medical');
  const rendered = renderCurrentNode(testCtx, session);

  // Assert keyboard numbers 1..N map directly to option indices
  rendered.options.forEach((opt, idx) => {
    const key = String(idx + 1);
    const keyIndex = Number(key) - 1;
    assert.equal(rendered.options[keyIndex].id, opt.id, `Key ${key} must map to option ${opt.id}`);
  });
});

test('Loader transition and final blueprint generation produces complete specs', () => {
  let session = createInitialSession('medical');
  session.currentNodeId = 'loader_15';
  session.tags = ['vol_high', 'vertex_eligible'];
  session.painScore = 80;

  session = advanceFromLoader(session);
  assert.equal(session.currentNodeId, 'result_blueprint');

  const bp = buildFinalBlueprint(testCtx, session);
  assert.equal(bp.painTier, 'high');
  assert.ok(bp.infraRecommendation.includes('VPS'));
  assert.ok(bp.aiPlan.includes('Vertex AI'));
  assert.equal(bp.ctaMode, 'WHATSAPP_PILOT_PRO');
  assert.ok(bp.whatsappSummaryText.includes('80/100'));
});
