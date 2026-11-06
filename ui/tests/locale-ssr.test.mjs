import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Render the real components in both locales without a WhatsApp connection.
// The API payloads stay unchanged while the surrounding interface is localized.
const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({
  root: uiRoot,
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
});
after(async () => { await vite.close(); });

const { LocaleProvider } = await vite.ssrLoadModule('/src/i18n.tsx');
const { ChatList } = await vite.ssrLoadModule('/src/components/ChatList.tsx');
const { ChatThread } = await vite.ssrLoadModule('/src/components/ChatThread.tsx');
const { ModeratorDrawer } = await vite.ssrLoadModule('/src/components/ModeratorDrawer.tsx');
const { App } = await vite.ssrLoadModule('/src/App.tsx');
const { PersonaSettingsPage } = await vite.ssrLoadModule('/src/components/PersonaSettingsPage.tsx');

const chat = {
  id: '201000000000@s.whatsapp.net',
  name: 'نور أحمد',
  lastMessage: 'صباح الخير',
  lastTimestamp: Date.now(),
  unreadCount: 1,
  isGroup: false,
  agentMode: 'copilot'
};
const draft = {
  id: 'draft-1',
  chatId: chat.id,
  incomingMessageId: 'message-1',
  incomingText: 'صباح الخير',
  proposedReply: 'أهلًا يا نور',
  confidence: .94,
  reasoning: 'رسالة ترحيب',
  status: 'pending',
  createdAt: Date.now()
};
const noop = async () => {};

function render(language, component) {
  return renderToStaticMarkup(React.createElement(LocaleProvider, { initial: language }, component));
}

test('Full app switches layout direction and active language state', () => {
  const ar = render('ar', React.createElement(App));
  const en = render('en', React.createElement(App));

  assert.match(ar, /class="wa-app" dir="rtl"/);
  assert.match(en, /class="wa-app" dir="ltr"/);
  assert.match(ar, /aria-label="لغة الواجهة"/);
  assert.match(en, /aria-label="Interface language"/);
  assert.match(ar, /aria-pressed="true" class="is-active">عربي/);
  assert.match(en, /aria-pressed="true" class="is-active">EN/);
  assert.match(ar, /الدردشات/);
  assert.match(en, /Chats/);
});

test('Arabic inbox stays RTL-ready and filters pending drafts by actual chat', () => {
  const html = render('ar', React.createElement(ChatList, {
    chats: [chat],
    selectedChatId: chat.id,
    pendingDraftChatIds: [chat.id],
    onSelectChat: () => {}
  }));
  assert.match(html, /الدردشات/);
  assert.match(html, /تحتاج مراجعة/);
  assert.match(html, /بانتظار موافقة/);
  assert.match(html, /نور أحمد/);
  assert.doesNotMatch(html, /Search chats/);
});

test('English inbox translates all controls while retaining contact message', () => {
  const html = render('en', React.createElement(ChatList, {
    chats: [chat],
    selectedChatId: chat.id,
    pendingDraftChatIds: [chat.id],
    onSelectChat: () => {}
  }));
  assert.match(html, /Chats/);
  assert.match(html, /Search chats/);
  assert.match(html, /Needs review/);
  assert.match(html, /Awaiting approval/);
  assert.match(html, /صباح الخير/);
  assert.doesNotMatch(html, /ابحث عن محادثة/);
});

test('Conversation controls render correctly in both interface languages', () => {
  const props = {
    chat,
    messages: [],
    onSendMessage: noop,
    onSendReaction: noop,
    onChangeMode: noop,
    onBack: () => {},
    onOpenInspector: () => {}
  };
  const ar = render('ar', React.createElement(ChatThread, props));
  const en = render('en', React.createElement(ChatThread, props));
  assert.match(ar, /وضع المحادثة/);
  assert.match(ar, /اكتب رسالة/);
  assert.match(en, /Chat mode/);
  assert.match(en, /Type a message/);
  assert.match(en, /Co-Pilot/);
  assert.match(en, /Back to chats/);
});

test('Assistant approval is available in English without translating user content', () => {
  const html = render('en', React.createElement(ModeratorDrawer, {
    view: 'assistant',
    drafts: [draft],
    selectedChatId: chat.id,
    selectedChatMode: 'copilot',
    onSelectChat: () => {},
    onApproveDraft: noop,
    onRejectDraft: noop,
    onOpenSimulator: () => {}
  }));
  assert.match(html, /AI assistant/);
  assert.match(html, /Review required/);
  assert.match(html, /Approve &amp; send/);
  assert.match(html, /94%/);
  assert.match(html, /أهلًا يا نور/);
});

test('Assistant settings is a standalone bilingual page, not a modal', () => {
  const persona = {
    name: 'Mamdouh assistant', language: 'ar-EG', tone: 'Natural', systemPrompt: 'Help with messages',
    rules: [], model: 'gemini-2.5-flash', temperature: 0.5, minConfidence: 0.75,
    simulateTypingDelay: true, minTypingDelayMs: 200, maxTypingDelayMs: 600
  };
  const en = render('en', React.createElement(PersonaSettingsPage, {
    initialPersona: persona, onClose: () => {}, onSave: noop
  }));
  const ar = render('ar', React.createElement(PersonaSettingsPage, {
    initialPersona: persona, onClose: () => {}, onSave: noop
  }));
  assert.match(en, /class="wa-settings-page"/);
  assert.match(en, /AI assistant settings/);
  assert.match(en, /Save settings/);
  assert.match(ar, /إعدادات المساعد الذكي/);
  assert.doesNotMatch(en, /role="dialog"/);
});

test('Only one assistant settings entry and collapsible inspector exist in the workspace', () => {
  const html = render('en', React.createElement(App));
  assert.equal((html.match(/aria-label="Assistant settings"/g) || []).length, 1);
  assert.match(html, /aria-label="Collapse AI assistant"/);
  assert.match(html, /aria-controls="wa-agent-panel"/);
});

test('WhatsApp receipt ticks only reflect explicit outbound statuses', () => {
  const statuses = ['pending', 'sent', 'delivered', 'read', undefined];
  const messages = statuses.map((status, index) => ({
    id: 'receipt-' + index, chatId: chat.id, text: 'Receipt ' + index,
    timestamp: Date.now() + index, isFromMe: true, sender: 'me', type: 'text', status
  }));
  const html = render('en', React.createElement(ChatThread, {
    chat, messages, onSendMessage: noop, onSendReaction: noop,
    onChangeMode: noop, onBack: () => {}, onOpenInspector: () => {}
  }));
  assert.equal((html.match(/aria-label="Pending"/g) || []).length, 1);
  assert.equal((html.match(/aria-label="Sent to WhatsApp"/g) || []).length, 1);
  assert.equal((html.match(/aria-label="Delivered"/g) || []).length, 1);
  assert.equal((html.match(/aria-label="Read"/g) || []).length, 1);
});
