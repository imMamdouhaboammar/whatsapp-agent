export type IndustryId =
  | 'medical'
  | 'ecommerce'
  | 'real_estate'
  | 'tourism'
  | 'hospitality'
  | 'education';

export type OpsMode = 'team' | 'solo' | 'existing_bot';

export type NodeType =
  | 'question'
  | 'reaction'
  | 'objection_handler'
  | 'loader'
  | 'result';

export type FieldSetter =
  | ['industry_id', IndustryId]
  | ['ops_mode', OpsMode];

export interface FunnelOption {
  id: string;
  label: string;
  sublabel?: string;
  add_tags?: string[];
  pain_delta?: number;
  set_field?: FieldSetter;
  next_node_override?: string;
}

export interface FunnelNode {
  id: string;
  type: NodeType;
  phase: 1 | 2 | 3 | 4;
  title_template: string;
  body_template?: string;
  options: FunnelOption[];
  default_next: string;
}

export interface CoreSpineConfig {
  version: string;
  totalEstimatedSteps: number;
  nodes: Record<string, FunnelNode>;
}

export interface IndustryVocab {
  industry_label: string;
  customer_singular: string;
  customer_plural: string;
}

export interface SampleMessage {
  sender: 'customer' | 'agent';
  text: string;
}

export interface IndustryPack {
  industry_id: IndustryId;
  name_ar: string;
  recommended_module_name: string;
  vocab: IndustryVocab;
  nodes: Record<string, FunnelNode>;
  sample_conversation: SampleMessage[];
}

export interface SessionSnapshot {
  industryId: IndustryId | null;
  opsMode: OpsMode | null;
  currentNodeId: string;
  answers: Record<string, string>;
  answerLabels: Record<string, string>;
  tags: string[];
  painScore: number;
  objectionsRaised: string[];
}

export interface UserSession extends SessionSnapshot {
  sessionId: string;
  startedAt: number;
  history: SessionSnapshot[];
}

export interface RenderedNode {
  id: string;
  type: NodeType;
  phase: 1 | 2 | 3 | 4;
  progressPercent: number;
  stepNumber: number;
  totalEstimatedSteps: number;
  title: string;
  body: string;
  options: FunnelOption[];
  canGoBack: boolean;
}

export type BlueprintCtaMode =
  | 'DOWNLOAD_FREE_CORE'
  | 'WHATSAPP_PILOT_PRO'
  | 'WHATSAPP_PILOT_STARTER';

export interface FinalBlueprint {
  industryId: IndustryId;
  industryName: string;
  moduleName: string;
  painScore: number;
  painTier: 'low' | 'medium' | 'high';
  painTierLabel: string;
  infraRecommendation: string;
  aiPlan: string;
  recommendedTier: string;
  sampleConversation: SampleMessage[];
  objectionsAddressedCount: number;
  ctaMode: BlueprintCtaMode;
  ctaLabel: string;
  ctaUrl: string;
  whatsappSummaryText: string;
  tags: string[];
}

export interface FunnelAnalyticsEvent {
  event:
    | 'funnel_started'
    | 'funnel_step_completed'
    | 'funnel_step_back'
    | 'funnel_objection_triggered'
    | 'funnel_completed'
    | 'funnel_cta_clicked';
  sessionId: string;
  industryId: IndustryId | null;
  nodeId: string;
  optionId?: string;
  nextNodeId?: string;
  painScore: number;
  timestamp: number;
}