import { describe, expect, it } from 'bun:test';
import {
  extractDynamicsInput,
  planRelationalMove,
  planReplyShape,
  planConversation,
  compileDynamicsPrompt,
} from '../src/ai/conversation-dynamics';

describe('Conversation Dynamics & Relational Move Planning', () => {
  it('identifies social pings (dots, marks, or short checks) accurately', () => {
    const ping1 = extractDynamicsInput('.');
    const ping2 = extractDynamicsInput('؟؟');
    const ping3 = extractDynamicsInput('فينك يا اسطى');

    expect(ping1.isSocialPing).toBe(true);
    expect(ping2.isSocialPing).toBe(true);
    expect(ping3.isSocialPing).toBe(true);

    const plan = planConversation(ping1);
    expect(plan.move).toBe('minimal_presence');
    expect(plan.shape.verbosity).toBe('micro');
    expect(plan.shape.askQuestion).toBe(false);
  });

  it('routes venting and distress to micro_care without interrogating the user', () => {
    const input = extractDynamicsInput('أنا تعبان ومخنوق جداً من الشغل قرف مش طبيعي');
    expect(input.expressesDistress).toBe(true);

    const plan = planConversation(input);
    expect(plan.move).toBe('micro_care');
    expect(plan.shape.askQuestion).toBe(false); // Crucial: don't interrogate a venting human
    expect(plan.shape.relationshipSignal).toBe('warm');
  });

  it('routes playfulness and banter to tease', () => {
    const input = extractDynamicsInput('ههههه إيه ده بتهزر ولا إيه يا راجل 😂');
    expect(input.userInvitesPlayfulness).toBe(true);

    const plan = planConversation(input);
    expect(plan.move).toBe('tease');
    expect(plan.shape.relationshipSignal).toBe('playful');
  });

  it('routes practical help requests and budgets one clarifying question if needed', () => {
    const input = extractDynamicsInput('ممكن تساعدني أعمل خطة للشغل ده؟');
    expect(input.requestsPracticalHelp).toBe(true);

    const plan = planConversation(input);
    expect(plan.move).toBe('practical_help');
    expect(plan.shape.askQuestion).toBe(true);
  });

  it('routes corrections gracefully to repair', () => {
    const input = extractDynamicsInput('لا غلط مش قصدي كدا خالص انت فهمت غلط');
    expect(input.containsCorrection).toBe(true);

    const plan = planConversation(input);
    expect(plan.move).toBe('repair');
    expect(plan.shape.askQuestion).toBe(false);
  });

  it('compiles actionable dynamics prompt directives', () => {
    const plan = planConversation(extractDynamicsInput('معلش تعبان شوية'));
    const prompt = compileDynamicsPrompt(plan);

    expect(prompt).toContain('=== تكتيك المحادثة لهذا الرد (Conversation Tactics & Dynamics) ===');
    expect(prompt).toContain('أظهر تعاطفاً وسنداً حقيقياً ومختصراً');
    expect(prompt).toContain('لا تختم ردك بسؤال استجوابي');
  });
});
