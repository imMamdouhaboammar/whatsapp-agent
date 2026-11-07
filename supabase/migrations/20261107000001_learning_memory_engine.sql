-- Migration: Continuous Learning & Self-Correction Engine for Supabase PostgreSQL
CREATE SCHEMA IF NOT EXISTS wa_agent;

-- Learning States (notebook.md and workbook.md persistent storage)
CREATE TABLE IF NOT EXISTS wa_agent.learning_states (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  state_type TEXT NOT NULL, -- 'workbook' | 'notebook'
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  metadata_json JSONB DEFAULT '{}'::jsonb,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_learning_states_brand 
  ON wa_agent.learning_states (brand_id, state_type);

-- Reflection Runs (Log of autonomous reflection executions)
CREATE TABLE IF NOT EXISTS wa_agent.learning_reflections (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  trigger_reason TEXT NOT NULL, -- 'idle_15m', 'thread_resolved', 'draft_feedback', 'manual'
  input_message_count INTEGER NOT NULL,
  self_corrections_count INTEGER DEFAULT 0,
  rules_added INTEGER DEFAULT 0,
  facts_added INTEGER DEFAULT 0,
  summary TEXT,
  raw_evaluation_json JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_learning_reflections_chat 
  ON wa_agent.learning_reflections (brand_id, chat_id, created_at DESC);

-- Human Moderation Feedback Events (Queue for the reflection engine)
CREATE TABLE IF NOT EXISTS wa_agent.learning_feedback_events (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  draft_id TEXT,
  feedback_type TEXT NOT NULL, -- 'rejected', 'edited', 'manual_override'
  original_reply TEXT,
  revised_reply TEXT,
  human_note TEXT,
  reflected SMALLINT DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_learning_feedback_unreflected 
  ON wa_agent.learning_feedback_events (brand_id, chat_id, reflected);

-- Thread Inactivity / Cold Tracker
CREATE TABLE IF NOT EXISTS wa_agent.thread_learning_status (
  brand_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  last_activity_at BIGINT NOT NULL,
  last_reflected_at BIGINT DEFAULT 0,
  is_cold SMALLINT DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (brand_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_thread_learning_cold 
  ON wa_agent.thread_learning_status (brand_id, last_activity_at, last_reflected_at);
