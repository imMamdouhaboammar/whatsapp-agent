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
const { OwnerAccessLogin, OwnerSignOutButton } = await vite.ssrLoadModule('/src/components/OwnerAccessGate.tsx');

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

await test('Full app switches layout direction and active language state', () => {
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

await test('Arabic inbox stays RTL-ready and filters pending drafts by actual chat', () => {
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

await test('English inbox translates all controls while retaining contact message', () => {
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

await test('Conversation controls render correctly in both interface languages', () => {
  const props = {
    chat,
    messages: [],
    onSendMessage: noop,
    onRetrySendIntent: noop,
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

await test('Video attachments retain inline playback and a truthful caption fallback in both locales', () => {
  const props = {
    chat,
    messages: [{
      id: 'video-preview', chatId: chat.id, sender: chat.id, text: '',
      timestamp: Date.now(), isFromMe: false, type: 'video', mediaUrl: '/media/example.mp4'
    }],
    onSendMessage: noop,
    onRetrySendIntent: noop,
    onSendReaction: noop,
    onChangeMode: noop,
    onBack: () => {},
    onOpenInspector: () => {}
  };
  for (const [language, label] of [['en', 'Captions unavailable'], ['ar', 'الترجمة النصية غير متوفرة']]) {
    const html = render(language, React.createElement(ChatThread, props));
    const video = html.match(/<video\b[^>]*>[\s\S]*?<\/video>/)?.[0];
    assert.ok(video, 'video must be playable within the message');
    assert.match(video, /src="\/media\/example\.mp4"/);
    assert.match(video, /controls=""/);
    assert.match(video, /preload="metadata"/);
    const track = video.match(/<track\b[^>]*>/)?.[0];
    assert.ok(track, 'video must contain a caption track');
    assert.match(track, /kind="captions"/);
    assert.match(track, new RegExp('label="' + label + '"'));
    assert.match(track, new RegExp('srcLang="' + language + '"', 'i'));
    assert.match(track, /src="data:text\/vtt;charset=utf-8,WEBVTT%0A%0A"/);
    assert.doesNotMatch(track, /\bdefault=/);
    assert.match(html, /<a[^>]*href="\/media\/example\.mp4"/);
  }
});

await test('uncertain delivery is visible and retry requires explicit confirmation in both locales', () => {
  const props = {
    chat,
    messages: [{
      id: 'intent:sample',
      sendIntentId: 'sample',
      chatId: chat.id,
      sender: 'me',
      text: 'Important reply',
      timestamp: Date.now(),
      isFromMe: true,
      type: 'text',
      status: 'pending',
      deliveryState: 'uncertain',
      lastAttemptAt: Date.now()
    }],
    onSendMessage: noop,
    onRetrySendIntent: noop,
    onSendReaction: noop,
    onChangeMode: noop,
    onBack: () => {},
    onOpenInspector: () => {}
  };
  const ar = render('ar', React.createElement(ChatThread, props));
  const en = render('en', React.createElement(ChatThread, props));
  assert.match(ar, /راجع واتساب قبل إعادة المحاولة/);
  assert.match(ar, /إعادة الإرسال بعد المراجعة/);
  assert.match(en, /Check WhatsApp before retrying/);
  assert.match(en, /Retry after checking/);
  assert.match(en, /role="alert"/);
});

await test('Assistant approval is available in English without translating user content', () => {
  const html = render('en', React.createElement(ModeratorDrawer, {
    view: 'assistant',
    drafts: [draft],
    selectedChatId: chat.id,
    selectedChatMode: 'copilot',
    onSelectChat: () => {},
    onApproveDraft: noop,
    onRejectDraft: noop,
  }));
  assert.match(html, /AI assistant/);
  assert.match(html, /Review required/);
  assert.match(html, /Approve &amp; send/);
  assert.match(html, /94%/);
  assert.match(html, /أهلًا يا نور/);
});

await test('Assistant settings provides a bilingual, accessible multi-section layout', () => {
  const persona = {
    name: 'Mamdouh assistant', language: 'ar-EG', tone: 'Natural', systemPrompt: 'Help with messages',
    rules: [], model: 'gemini-3.8-flash', temperature: 0.5, minConfidence: 0.75,
    simulateTypingDelay: true, minTypingDelayMs: 200, maxTypingDelayMs: 600
  };
  const props = { initialPersona: persona, onClose: () => {}, onSave: noop };
  const en = render('en', React.createElement(PersonaSettingsPage, props));
  const ar = render('ar', React.createElement(PersonaSettingsPage, props));
  assert.match(en, /class="wa-premium-settings"/);
  assert.match(en, /AI assistant/);
  assert.match(en, /Models &amp; providers/);
  assert.match(en, /Core instructions/);
  assert.match(en, /Save changes/);
  assert.doesNotMatch(en, /Try your assistant|Test a real response/);
  assert.doesNotMatch(ar, /جرّب مساعدك|اختبار رد حقيقي/);
  assert.match(ar, /المساعد الذكي/);
  assert.match(ar, /النماذج ومزودو الخدمة/);
  assert.match(ar, /التعليمات الأساسية/);
  assert.match(ar, /حفظ التغييرات/);
  assert.match(ar, /dir="auto"/);
  assert.doesNotMatch(en, /<dialog\b|role="dialog"/);
});

await test('Models & providers is directly accessible with existing controls', () => {
  const persona = {
    name: 'Mamdouh', language: 'ar-EG', tone: 'Natural', systemPrompt: 'Help',
    rules: [], model: 'gemini-3.1-pro', temperature: 0.5, minConfidence: 0.85,
    simulateTypingDelay: false, minTypingDelayMs: 200, maxTypingDelayMs: 600,
    voiceName: 'kore'
  };
  const previousWindow = globalThis.window;
  globalThis.window = { location: { pathname: '/settings/models' } };
  try {
    const html = render('en', React.createElement(PersonaSettingsPage, {
      initialPersona: persona, onClose: () => {}, onSave: noop
    }));
    assert.match(html, /Primary AI model/);
    assert.match(html, /Voice notes/);
    assert.match(html, /Minimum confidence/);
    assert.match(html, /Natural typing delay/);
    assert.match(html, /85%/);
    assert.match(html, /gemini-3.1-pro/);
  } finally {
    globalThis.window = previousWindow;
  }
});

await test('Only one assistant settings entry and collapsible inspector exist in the workspace', () => {
  const html = render('en', React.createElement(App));
  assert.equal((html.match(/aria-label="Assistant settings"/g) || []).length, 1);
  assert.match(html, /aria-label="AI assistant, collapse panel"/);
  assert.match(html, /aria-controls="wa-agent-panel"/);
});

await test('WhatsApp receipt ticks only reflect explicit outbound statuses', () => {
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

await test('Owner access uses a bilingual private login with a password field', () => {
  const props = { onLogin: async () => {}, onRetry: () => {} };
  const en = render('en', React.createElement(OwnerAccessLogin, props));
  const ar = render('ar', React.createElement(OwnerAccessLogin, props));
  assert.match(en, /Owner access/);
  assert.match(en, /Access your workspace/);
  assert.match(en, /type="password"/);
  assert.match(en, /autocomplete="current-password"/i);
  assert.match(ar, /دخول المالك/);
  assert.match(ar, /الدخول لمساحة العمل/);
  assert.match(ar, /dir="rtl"/);
});

await test('Owner can explicitly sign out in Arabic and English when access protection is enabled', () => {
  const props = { onSignOut: async () => {}, pending: false };
  const ar = render('ar', React.createElement(OwnerSignOutButton, props));
  const en = render('en', React.createElement(OwnerSignOutButton, props));
  assert.match(ar, /تسجيل الخروج/);
  assert.match(en, /Sign out/);
  assert.match(en, /type="button"/);
});

await test('assistant editor exposes saved rules in both languages without placeholder sections', () => {
  const persona={name:'Support',language:'ar-EG',tone:'Natural',systemPrompt:'Help',rules:['Confirm availability'],model:'gemini-4-argon',temperature:0.7,minConfidence:0.8,simulateTypingDelay:false,minTypingDelayMs:200,maxTypingDelayMs:600};
  const props={initialPersona:persona,onClose:()=>{},onSave:async()=>persona};
  for (const locale of ['en','ar']) {
    const html=render(locale,React.createElement(PersonaSettingsPage,props));
    assert.match(html,/Confirm availability/);
    assert.match(html,locale==='en'?/Conversation rules/:/قواعد التعامل/);
    assert.match(html,locale==='en'?/Add rule/:/إضافة قاعدة/);
    assert.doesNotMatch(html,/wa-ps-nav-link is-future|bg-slate-900/);
  }
});
