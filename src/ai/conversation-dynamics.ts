/**
 * Conversation Dynamics & Relational Move Planner
 *
 * Inspired by Rafiq-July conversationDynamics subsystem.
 * Analyzes conversational turn signals to plan the appropriate relational move
 * (answer, acknowledge, probe, callback, micro_care, practical_help, tease, disagree, repair, minimal_presence)
 * and shape the reply (bubble count, verbosity, question budgeting, and relationship signal).
 */

export type ConversationMove =
  | 'answer'
  | 'acknowledge'
  | 'probe'
  | 'callback'
  | 'micro_care'
  | 'practical_help'
  | 'tease'
  | 'disagree'
  | 'repair'
  | 'topic_shift'
  | 'shared_reference'
  | 'minimal_presence';

export interface DynamicsInput {
  messageTextLength: number;
  isSocialPing: boolean;
  asksConcreteQuestion: boolean;
  requestsPracticalHelp: boolean;
  expressesDistress: boolean;
  containsCorrection: boolean;
  activeConflict: boolean;
  userInvitesPlayfulness: boolean;
  userExpressesOpinion: boolean;
  recentBurstCount: number;
}

export interface ReplyShape {
  bubbleCount: 1 | 2 | 3;
  verbosity: 'micro' | 'short' | 'normal';
  askQuestion: boolean;
  allowTopicShift: boolean;
  relationshipSignal: 'none' | 'warm' | 'playful';
}

export interface ConversationPlan {
  move: ConversationMove;
  shape: ReplyShape;
}

/**
 * Extracts conversation signals from raw incoming message text and thread context
 */
export function extractDynamicsInput(text: string, recentBurstCount = 1): DynamicsInput {
  const trimmed = text.trim();
  const len = trimmed.length;

  // Social Ping: "." or "؟؟" or "فينك" or "يا اسطى" or "ازيك" or short greetings/nudges
  const isSocialPing = len <= 25 && (
    /^[.؟?!\s]+$/.test(trimmed) ||
    /^(?:فينك|انت فين|يا اسطى|ازيك|صباح الخير|مساء الخير|الو|ألو|سلام عليكم|موجود|رد|يا عمي?|يا غالي|يا صاحبي|صاحبي)(?:\s+(?:فينك|انت فين|يا اسطى|ازيك|صباح الخير|موجود|رد|يا عمي?|يا غالي|يا صاحبي|صاحبي))*[؟?!.\s]*$/i.test(trimmed)
  );

  const asksConcreteQuestion = /[?؟]/.test(trimmed) || /^(ليه|ازاي|كام|فين|متى|مين|هل|what|why|how|where|when|is|can)\b/i.test(trimmed);

  const requestsPracticalHelp = /(ممكن تساعدني|عاوز مساعدة|محتاج|عايزك|حل لمشكلة|طلب|خدمة|ممكن تفهمني|help|can you help)/i.test(trimmed);

  const expressesDistress = /(تعبان|مخنوق|زهقان|الشغل قرف|حزين|مش قادر|فصلت|مكتئب|احباط|إحباط|محبط|يومي صعب|عندي مشكلة كبيرة|depressed|exhausted|sad)/i.test(trimmed);

  const containsCorrection = /(لا غلط|مش كدا|مش قصدي|انت فهمت غلط|لأ بالعكس|you got it wrong|not what i meant)/i.test(trimmed);

  const activeConflict = /(انت غبي|مش فاهم حاجة|كلامك عبيط|بطل غباء|متعصب|زعلان منك)/i.test(trimmed);

  const userInvitesPlayfulness = /(هههه|ههه|نكتة|ألش|القلش|يا راجل|بتهزر|lol|haha|lmao|rofl|😂|🤣)/i.test(trimmed);

  const userExpressesOpinion = /(أنا شايف|في رأيي|بصراحة|بحس إن|وجهة نظري|أعتقد|i think|in my opinion|honestly)/i.test(trimmed);

  return {
    messageTextLength: len,
    isSocialPing,
    asksConcreteQuestion,
    requestsPracticalHelp,
    expressesDistress,
    containsCorrection,
    activeConflict,
    userInvitesPlayfulness,
    userExpressesOpinion,
    recentBurstCount,
  };
}

/**
 * Plans the relational move based on conversational signals
 */
export function planRelationalMove(input: DynamicsInput): ConversationMove {
  if (input.containsCorrection) return 'repair';
  if (input.requestsPracticalHelp) return 'practical_help';
  if (input.expressesDistress) return 'micro_care';
  if (input.userInvitesPlayfulness && !input.activeConflict) return 'tease';
  if (input.isSocialPing) return 'minimal_presence';
  if (input.asksConcreteQuestion) return 'answer';
  if (input.userExpressesOpinion) return 'acknowledge';
  return 'acknowledge';
}

/**
 * Plans the reply shape (bubble count, verbosity, question budgeting)
 */
export function planReplyShape(move: ConversationMove, input: DynamicsInput): ReplyShape {
  if (move === 'minimal_presence') {
    return {
      bubbleCount: 1,
      verbosity: 'micro',
      askQuestion: false,
      allowTopicShift: false,
      relationshipSignal: 'warm',
    };
  }

  if (move === 'tease') {
    return {
      bubbleCount: input.recentBurstCount >= 2 ? 2 : 1,
      verbosity: 'short',
      askQuestion: false,
      allowTopicShift: true,
      relationshipSignal: 'playful',
    };
  }

  if (move === 'micro_care') {
    return {
      bubbleCount: input.recentBurstCount >= 2 ? 2 : 1,
      verbosity: 'short',
      askQuestion: false, // Don't interrogate when someone is venting/distressed!
      allowTopicShift: false,
      relationshipSignal: 'warm',
    };
  }

  if (move === 'practical_help') {
    return {
      bubbleCount: 2,
      verbosity: 'normal',
      askQuestion: true, // One helpful scoping question is fine
      allowTopicShift: false,
      relationshipSignal: 'warm',
    };
  }

  if (move === 'repair') {
    return {
      bubbleCount: 1,
      verbosity: 'short',
      askQuestion: false,
      allowTopicShift: false,
      relationshipSignal: 'warm',
    };
  }

  // Answer or acknowledge
  const bubbleCount = input.recentBurstCount >= 3 ? 2 : 1;
  return {
    bubbleCount,
    verbosity: 'short',
    askQuestion: false, // Default to not interrogating the user
    allowTopicShift: true,
    relationshipSignal: 'warm',
  };
}

/**
 * Plans complete conversation strategy
 */
export function planConversation(input: DynamicsInput): ConversationPlan {
  const move = planRelationalMove(input);
  const shape = planReplyShape(move, input);
  return { move, shape };
}

const MOVE_INSTRUCTIONS: Record<ConversationMove, string> = {
  answer: 'جاوب مباشرة على سؤال المتصل باختصار ومباشرة وبدون ما تحول المحادثة لاستجواب.',
  acknowledge: 'تفاعل مع كلامه بشكل طبيعي وودود. لا تطول في الرد بدون داعٍ.',
  probe: 'اسأل سؤالاً واحداً فقط للاستيضاح بشكل لطيف.',
  callback: 'ارجع لموضوع سابق كان بينكم بشكل عفوي وذكي.',
  micro_care: 'أظهر تعاطفاً وسنداً حقيقياً ومختصراً (معلش يا صاحبي، فداك، كبر مخك). إياك واستخدام عبارات الدعم النفسي المعلبة أو أوراق عمل العلاج المعرفي السلوكي.',
  practical_help: 'ساعد المتصل في مشكلته بخطوات عملية واضحة ومباشرة.',
  tease: 'هزار خفيف لطيف بدون مبالغة أو إحراج أو تريقة جارحة.',
  disagree: 'وضح وجهة نظرك باحترام وبدون تصنع أو فرض رأي.',
  repair: 'تقبل التصحيح بلطف وسلاسة وبدون دراما أو اعتذارات طويلة متكلفة.',
  topic_shift: 'انقل المحادثة لموضوع مناسب بشكل سلس.',
  shared_reference: 'استخدم ما تم الاتفاق عليه سابقاً بشكل طبيعي.',
  minimal_presence: 'رد بحضور بسيط ومباشر (نعم، معاك اهو، اتفضل يا صاحبي، قول سامعك) بدون تكلف.',
};

/**
 * Compiles dynamic conversation plan into prompt directives
 */
export function compileDynamicsPrompt(plan: ConversationPlan): string {
  const lines: string[] = [
    '=== تكتيك المحادثة لهذا الرد (Conversation Tactics & Dynamics) ===',
    `- نمط التفاعل المختار: ${MOVE_INSTRUCTIONS[plan.move]}`,
    `- شكل الرد: استخدم ${plan.shape.bubbleCount} فقرة/فقاعة رسائل (bubbles) بحد أقصى (يمكنك الفصل بينها بالرمز "|||" لتبدو كرسائل واتساب متتالية واقعية)، وبطول إجمالي ${plan.shape.verbosity === 'micro' ? 'قصير جداً (كلمات معدودة)' : plan.shape.verbosity === 'short' ? 'قصير وموجز' : 'طبيعي ومحدد'}.`,
  ];

  if (!plan.shape.askQuestion) {
    lines.push('- لا تختم ردك بسؤال استجوابي؛ دع المحادثة تتنفس بانسيابية بين أخذ وعطاء.');
  } else {
    lines.push('- يُسمح بسؤال واحد طبيعي ومباشر فقط إن كان ضرورياً للمساعدة.');
  }

  if (plan.shape.relationshipSignal === 'playful') {
    lines.push('- اضف لمسة فكاهة أو ألش مصري خفيف.');
  }

  return lines.join('\n');
}
