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
  goBack,
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

const INDUSTRIES = ['medical', 'ecommerce', 'real_estate', 'tourism', 'hospitality', 'education'];
const OPS_MODES = ['team', 'solo', 'existing_bot'];

await test('18 end-to-end traversals (3 ops modes × 6 industries) run to completion', () => {
  for (const industryId of INDUSTRIES) {
    for (const opsMode of OPS_MODES) {
      let session = createInitialSession();

      // Step 1: Select Industry
      const step1 = selectOption(testCtx, session, industryId);
      session = step1.nextSession;
      assert.equal(session.industryId, industryId);
      assert.equal(session.currentNodeId, 'q02_ops_mode');

      // Step 2: Select Ops Mode
      const step2 = selectOption(testCtx, session, opsMode);
      session = step2.nextSession;
      assert.equal(session.opsMode, opsMode);

      // Walk through until loader_15 or result_blueprint
      let safetyCounter = 0;
      while (session.currentNodeId !== 'loader_15' && session.currentNodeId !== 'result_blueprint') {
        safetyCounter++;
        if (safetyCounter > 40) {
          assert.fail(`Loop detected in traversal for industry=${industryId}, opsMode=${opsMode} at node=${session.currentNodeId}`);
        }

        const rendered = renderCurrentNode(testCtx, session);
        assert.ok(rendered.options.length > 0, `Node ${rendered.id} has no options`);
        // Pick the first option to advance
        const picked = rendered.options[0];
        const step = selectOption(testCtx, session, picked.id);
        session = step.nextSession;
      }

      if (session.currentNodeId === 'loader_15') {
        session = advanceFromLoader(session);
      }

      assert.equal(session.currentNodeId, 'result_blueprint');

      const blueprint = buildFinalBlueprint(testCtx, session);
      assert.equal(blueprint.industryId, industryId);
      assert.ok(blueprint.industryName, 'blueprint must have industryName');
      assert.ok(blueprint.moduleName, 'blueprint must have moduleName');
      assert.ok(blueprint.infraRecommendation, 'blueprint must have infraRecommendation');
      assert.ok(blueprint.aiPlan, 'blueprint must have aiPlan');
      assert.ok(blueprint.recommendedTier, 'blueprint must have recommendedTier');
      assert.ok(blueprint.ctaUrl.startsWith('https://'), 'blueprint ctaUrl must be https');
      assert.ok(blueprint.sampleConversation.length >= 2, 'blueprint sampleConversation must have messages');
    }
  }
});

await test('clicking "لأ مش مقتنع" (skeptical tag) routes to objection_handler and records objection', () => {
  let session = createInitialSession('medical');
  assert.equal(session.currentNodeId, 'q02_ops_mode');

  // Select team ops mode -> routes to q03_team_speed
  session = selectOption(testCtx, session, 'team').nextSession;
  assert.equal(session.currentNodeId, 'q03_team_speed');

  // Advance to r04_team_stamina
  session = selectOption(testCtx, session, '5_to_15m').nextSession;
  assert.equal(session.currentNodeId, 'r04_team_stamina');

  // Click "لأ مش مقتنع" (disagree)
  const result = selectOption(testCtx, session, 'disagree');
  assert.equal(result.triggeredObjection, true, 'must flag triggeredObjection as true');
  assert.equal(result.nextSession.currentNodeId, 'obj04_team_stamina', 'must route to objection node');
  assert.equal(result.nextSession.objectionsRaised.length, 1);
  assert.equal(result.nextSession.objectionsRaised[0], 'r04_team_stamina');
});

await test('goBack() restores exact snapshot with zero leaked tags or score drift across branch changes', () => {
  let session = createInitialSession();

  // Answer 1: industry medical (+5 pain)
  session = selectOption(testCtx, session, 'medical').nextSession;
  // Answer 2: ops team (+10 pain)
  session = selectOption(testCtx, session, 'team').nextSession;
  const snapshotStep2 = {
    industryId: session.industryId,
    opsMode: session.opsMode,
    currentNodeId: session.currentNodeId,
    painScore: session.painScore,
    tags: [...session.tags],
    answers: { ...session.answers },
  };

  // Answer 3: q03_team_speed (+15 pain, adds tag night_leak)
  session = selectOption(testCtx, session, '5_to_15m').nextSession;
  // Answer 4: r04_team_stamina (+15 pain)
  session = selectOption(testCtx, session, 'agree').nextSession;

  assert.equal(session.history.length, 4);
  assert.ok(session.painScore > snapshotStep2.painScore);

  // Now go back 2 steps
  session = goBack(session);
  session = goBack(session);

  // Assert exact state matches step 2 snapshot
  assert.equal(session.industryId, snapshotStep2.industryId);
  assert.equal(session.opsMode, snapshotStep2.opsMode);
  assert.equal(session.currentNodeId, snapshotStep2.currentNodeId);
  assert.equal(session.painScore, snapshotStep2.painScore);
  assert.deepEqual(session.tags, snapshotStep2.tags);
  assert.deepEqual(session.answers, snapshotStep2.answers);

  // Now go back one more step to change opsMode from team to solo
  session = goBack(session);
  assert.equal(session.currentNodeId, 'q02_ops_mode');

  // Pick solo ops mode branch
  session = selectOption(testCtx, session, 'solo').nextSession;
  assert.equal(session.opsMode, 'solo');
  assert.equal(session.currentNodeId, 'q03_solo_bottleneck');
  assert.ok(!session.tags.includes('has_team'), 'has_team tag must not leak into solo branch');
});

await test('painScore stays clamped between 0 and 100', () => {
  const session = createInitialSession('medical');

  // Verify floor clamp at 0
  assert.equal(session.painScore, 0);
  const fakeOptionMin = {
    id: 'test_min',
    label: 'test',
    pain_delta: -50,
  };
  const testNode = {
    id: 'test_node',
    type: 'question',
    phase: 1,
    title_template: 'test',
    options: [fakeOptionMin],
    default_next: 'q03_team_speed',
  };
  const ctxWithTest = {
    ...testCtx,
    coreSpine: {
      ...CORE_SPINE,
      nodes: {
        ...CORE_SPINE.nodes,
        q02_ops_mode: testNode,
      },
    },
  };

  const resMin = selectOption(ctxWithTest, session, 'test_min');
  assert.equal(resMin.nextSession.painScore, 0, 'painScore must clamp to 0 on negative delta');

  // Verify ceiling clamp at 100
  const highPainSession = { ...session, painScore: 90 };
  const fakeOptionMax = {
    id: 'test_max',
    label: 'test',
    pain_delta: 30,
  };
  const testNodeMax = {
    ...testNode,
    options: [fakeOptionMax],
  };
  const ctxWithMax = {
    ...testCtx,
    coreSpine: {
      ...CORE_SPINE,
      nodes: {
        ...CORE_SPINE.nodes,
        q02_ops_mode: testNodeMax,
      },
    },
  };
  const resMax = selectOption(ctxWithMax, highPainSession, 'test_max');
  assert.equal(resMax.nextSession.painScore, 100, 'painScore must clamp to 100 on ceiling overflow');
});

await test('initialIndustry pre-seeding starts at q02_ops_mode with canGoBack: false', () => {
  const session = createInitialSession('medical');
  assert.equal(session.industryId, 'medical');
  assert.equal(session.currentNodeId, 'q02_ops_mode');
  assert.equal(session.answers['q01_industry'], 'medical');
  assert.equal(session.history.length, 0);

  const rendered = renderCurrentNode(testCtx, session);
  assert.equal(rendered.id, 'q02_ops_mode');
  assert.equal(rendered.canGoBack, false, 'canGoBack must be false when pre-seeded with empty history');
});

await test('buildFinalBlueprint() generates valid wa.me URI-encoded URL and routes self_hosted_diy correctly', () => {
  // Test WhatsApp Pilot route
  const standardSession = {
    ...createInitialSession('medical'),
    opsMode: 'team',
    painScore: 75,
    tags: ['vol_high'],
    answers: {
      q11_daily_volume: 'vol_high',
      q13_vertex_ai: 'eligible',
    },
  };

  const standardBlueprint = buildFinalBlueprint(testCtx, standardSession);
  assert.equal(standardBlueprint.ctaMode, 'WHATSAPP_PILOT_PRO');
  assert.ok(standardBlueprint.ctaUrl.startsWith('https://wa.me/201012345678?text='));
  const urlParam = standardBlueprint.ctaUrl.split('?text=')[1];
  assert.ok(urlParam, 'URL must have text param');
  const decodedText = decodeURIComponent(urlParam);
  assert.ok(decodedText.includes('أهلاً، خلصت التقييم التفاعلي لوكيل واتساب:'), 'decoded text must contain Arabic greeting');
  assert.ok(decodedText.includes('العيادات والمراكز الطبية'), 'decoded text must contain industry name');

  // Test DIY route
  const diySession = {
    ...standardSession,
    tags: ['self_hosted_diy'],
  };
  const diyBlueprint = buildFinalBlueprint(testCtx, diySession);
  assert.equal(diyBlueprint.ctaMode, 'DOWNLOAD_FREE_CORE');
  assert.equal(diyBlueprint.ctaUrl, testCtx.freeDownloadUrl);
  assert.match(diyBlueprint.ctaLabel, /نزل النسخة المجانية/);
});
