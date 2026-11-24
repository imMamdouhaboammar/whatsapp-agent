import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(__dirname, '../src/marketing/lead-funnel/data');

const coreSpine = JSON.parse(readFileSync(join(dataDir, 'core-spine.json'), 'utf8'));

const INDUSTRY_KEYS = ['medical', 'ecommerce', 'real-estate', 'tourism', 'hospitality', 'education'];
const REQUIRED_INDUSTRY_NODES = ['ind_q1', 'ind_react1', 'ind_obj1', 'ind_q2', 'ind_react2', 'ind_obj2'];
const REQUIRED_VOCAB_KEYS = ['industry_label', 'customer_singular', 'customer_plural'];

const industryPacks = {};
for (const key of INDUSTRY_KEYS) {
  industryPacks[key] = JSON.parse(readFileSync(join(dataDir, 'industries', `${key}.json`), 'utf8'));
}

test('core-spine.json has valid structure and required fields', () => {
  assert.ok(coreSpine.version, 'core spine must have version');
  assert.equal(typeof coreSpine.totalEstimatedSteps, 'number', 'totalEstimatedSteps must be number');
  assert.ok(coreSpine.totalEstimatedSteps > 0, 'totalEstimatedSteps must be positive');
  assert.ok(coreSpine.nodes && typeof coreSpine.nodes === 'object', 'core spine must contain nodes map');
  assert.ok(Object.keys(coreSpine.nodes).length >= 15, 'core spine must contain at least 15 nodes');
});

test('all 6 industry packs contain required nodes, non-empty vocab, and sample conversations', () => {
  for (const indKey of INDUSTRY_KEYS) {
    const pack = industryPacks[indKey];
    assert.ok(pack.name_ar, `${indKey} must have name_ar`);
    assert.ok(pack.recommended_module_name, `${indKey} must have recommended_module_name`);

    // Vocab checks
    assert.ok(pack.vocab, `${indKey} must have vocab`);
    for (const vKey of REQUIRED_VOCAB_KEYS) {
      assert.ok(pack.vocab[vKey], `${indKey} vocab.${vKey} must be non-empty`);
      assert.equal(typeof pack.vocab[vKey], 'string');
    }

    // Required industry nodes checks
    assert.ok(pack.nodes, `${indKey} must have nodes map`);
    for (const nodeKey of REQUIRED_INDUSTRY_NODES) {
      const node = pack.nodes[nodeKey];
      assert.ok(node, `${indKey} missing required node "${nodeKey}"`);
      assert.equal(node.id, nodeKey, `${indKey} node id must match key "${nodeKey}"`);
      assert.ok(['question', 'reaction', 'objection_handler'].includes(node.type), `${indKey} node ${nodeKey} has unexpected type ${node.type}`);
      assert.ok(node.title_template, `${indKey} node ${nodeKey} must have title_template`);
      assert.ok(Array.isArray(node.options), `${indKey} node ${nodeKey} options must be an array`);
      assert.ok(node.options.length > 0, `${indKey} node ${nodeKey} options must not be empty`);
    }

    // Sample conversation checks
    assert.ok(Array.isArray(pack.sample_conversation), `${indKey} sample_conversation must be an array`);
    assert.ok(pack.sample_conversation.length >= 2, `${indKey} sample_conversation must have at least 2 messages`);
    for (const msg of pack.sample_conversation) {
      assert.ok(['customer', 'agent'].includes(msg.sender), `sender must be customer or agent`);
      assert.ok(typeof msg.text === 'string' && msg.text.trim().length > 0, `message text must be non-empty`);
    }
  }
});

test('graph link integrity: all default_next and next_node_override resolve with zero dead ends', () => {
  const allCoreNodeIds = new Set(Object.keys(coreSpine.nodes));
  const validGlobalTargets = new Set([...allCoreNodeIds, 'ind_q1', 'result_blueprint']);

  // Validate core spine transitions
  for (const [nodeId, node] of Object.entries(coreSpine.nodes)) {
    if (node.type === 'loader') {
      // loader transitions dynamically to result_blueprint
      continue;
    }

    // Verify default_next
    if (node.default_next) {
      assert.ok(
        validGlobalTargets.has(node.default_next),
        `Core node "${nodeId}" default_next "${node.default_next}" does not resolve to a valid node`,
      );
    }

    // Verify next_node_override on options
    for (const opt of node.options || []) {
      if (opt.next_node_override) {
        assert.ok(
          validGlobalTargets.has(opt.next_node_override),
          `Core node "${nodeId}" option "${opt.id}" override "${opt.next_node_override}" does not resolve to a valid node`,
        );
      }
    }
  }

  // Validate industry pack transitions
  for (const indKey of INDUSTRY_KEYS) {
    const pack = industryPacks[indKey];
    const indNodeIds = new Set(Object.keys(pack.nodes));
    const validIndTargets = new Set([...indNodeIds, ...allCoreNodeIds, 'result_blueprint']);

    for (const [nodeId, node] of Object.entries(pack.nodes)) {
      if (node.default_next) {
        assert.ok(
          validIndTargets.has(node.default_next),
          `Industry "${indKey}" node "${nodeId}" default_next "${node.default_next}" does not resolve`,
        );
      }

      for (const opt of node.options || []) {
        if (opt.next_node_override) {
          assert.ok(
            validIndTargets.has(opt.next_node_override),
            `Industry "${indKey}" node "${nodeId}" option "${opt.id}" override "${opt.next_node_override}" does not resolve`,
          );
        }
      }
    }
  }
});

test('zero unresolved {{variable}} template placeholders across all nodes and industries', () => {
  const allowedVars = new Set(REQUIRED_VOCAB_KEYS);

  function checkTemplates(sourceName, nodes, vocab) {
    for (const [nodeId, node] of Object.entries(nodes)) {
      const templates = [
        { field: 'title_template', text: node.title_template },
        { field: 'body_template', text: node.body_template || '' },
      ];

      for (const { field, text } of templates) {
        const matches = text.match(/\{\{(\w+)\}\}/g) || [];
        for (const match of matches) {
          const varName = match.replace(/[{}]/g, '');
          assert.ok(
            allowedVars.has(varName),
            `${sourceName} node "${nodeId}" has unexpected template var "${varName}" in ${field}`,
          );
        }

        // Simulate interpolation and check that no {{ or }} remains
        const rendered = text.replace(/\{\{(\w+)\}\}/g, (_m, key) => vocab[key] || '');
        assert.ok(!rendered.includes('{{') && !rendered.includes('}}'), `${sourceName} node "${nodeId}" has unclosed braces in ${field}: "${rendered}"`);
      }
    }
  }

  // Check core nodes with generic vocab
  const genericVocab = {
    industry_label: 'بيزنسك',
    customer_singular: 'العميل',
    customer_plural: 'العملاء',
  };
  checkTemplates('Core Spine', coreSpine.nodes, genericVocab);

  // Check each industry pack with its specific vocab
  for (const indKey of INDUSTRY_KEYS) {
    const pack = industryPacks[indKey];
    checkTemplates(`Industry ${indKey}`, pack.nodes, pack.vocab);
  }
});
