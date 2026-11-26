import coreSpineJson from './data/core-spine.json';
import medicalJson from './data/industries/medical.json';
import ecommerceJson from './data/industries/ecommerce.json';
import realEstateJson from './data/industries/real-estate.json';
import tourismJson from './data/industries/tourism.json';
import hospitalityJson from './data/industries/hospitality.json';
import educationJson from './data/industries/education.json';
import type { CoreSpineConfig, FieldSetter, FunnelNode, FunnelOption, IndustryId, IndustryPack, IndustryVocab, SampleMessage } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const isIndustryId = (value: unknown): value is IndustryId => {
  return value === 'medical' || value === 'ecommerce' || value === 'real_estate'
    || value === 'tourism' || value === 'hospitality' || value === 'education';
};

function isFieldSetter(value: unknown): value is FieldSetter {
  return Array.isArray(value) && value.length === 2 && (
    (value[0] === 'industry_id' && isIndustryId(value[1]))
    || (value[0] === 'ops_mode' && (value[1] === 'team' || value[1] === 'solo' || value[1] === 'existing_bot'))
  );
}

function isOption(value: unknown): value is FunnelOption {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && (value.sublabel === undefined || typeof value.sublabel === 'string')
    && (value.add_tags === undefined || (Array.isArray(value.add_tags) && value.add_tags.every((tag) => typeof tag === 'string')))
    && (value.pain_delta === undefined || typeof value.pain_delta === 'number')
    && (value.set_field === undefined || isFieldSetter(value.set_field))
    && (value.next_node_override === undefined || typeof value.next_node_override === 'string');
}

function isNode(value: unknown): value is FunnelNode {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.type === 'question' || value.type === 'reaction' || value.type === 'objection_handler'
      || value.type === 'loader' || value.type === 'result')
    && (value.phase === 1 || value.phase === 2 || value.phase === 3 || value.phase === 4)
    && typeof value.title_template === 'string'
    && (value.body_template === undefined || typeof value.body_template === 'string')
    && Array.isArray(value.options) && value.options.every(isOption)
    && typeof value.default_next === 'string';
}

function isNodeMap(value: unknown): value is Record<string, FunnelNode> {
  return isRecord(value) && Object.values(value).every(isNode);
}

function isVocab(value: unknown): value is IndustryVocab {
  return isRecord(value)
    && typeof value.industry_label === 'string'
    && typeof value.customer_singular === 'string'
    && typeof value.customer_plural === 'string';
}

function isSampleMessage(value: unknown): value is SampleMessage {
  return isRecord(value) && (value.sender === 'customer' || value.sender === 'agent') && typeof value.text === 'string';
}

function loadCoreSpine(value: unknown): CoreSpineConfig {
  if (isRecord(value) && typeof value.version === 'string'
    && typeof value.totalEstimatedSteps === 'number' && isNodeMap(value.nodes)) {
    return { version: value.version, totalEstimatedSteps: value.totalEstimatedSteps, nodes: value.nodes };
  }
  throw new Error('Invalid lead-funnel core spine');
}

function loadIndustryPack(value: unknown, expectedIndustry: IndustryId): IndustryPack {
  if (isRecord(value) && value.industry_id === expectedIndustry
    && typeof value.name_ar === 'string' && typeof value.recommended_module_name === 'string'
    && isVocab(value.vocab) && isNodeMap(value.nodes)
    && Array.isArray(value.sample_conversation) && value.sample_conversation.every(isSampleMessage)) {
    return {
      industry_id: expectedIndustry,
      name_ar: value.name_ar,
      recommended_module_name: value.recommended_module_name,
      vocab: value.vocab,
      nodes: value.nodes,
      sample_conversation: value.sample_conversation,
    };
  }
  throw new Error(`Invalid lead-funnel pack: ${expectedIndustry}`);
}

export const CORE_SPINE = loadCoreSpine(coreSpineJson);

export const INDUSTRY_PACKS: Record<IndustryId, IndustryPack> = {
  medical: loadIndustryPack(medicalJson, 'medical'),
  ecommerce: loadIndustryPack(ecommerceJson, 'ecommerce'),
  real_estate: loadIndustryPack(realEstateJson, 'real_estate'),
  tourism: loadIndustryPack(tourismJson, 'tourism'),
  hospitality: loadIndustryPack(hospitalityJson, 'hospitality'),
  education: loadIndustryPack(educationJson, 'education'),
};
