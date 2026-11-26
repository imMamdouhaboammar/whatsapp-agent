/**
 * Dignity Guardian & Boundary Defense
 *
 * Inspired by Rafiq-July DignityGuardian architecture.
 * Implements conversational boundaries, prompt injection defense, and disgust ledger.
 * A real human does not tolerate endless humiliation or prompt extraction attacks;
 * they enforce healthy social boundaries while remaining warm and open to sincere reconciliation.
 */

export type DignityLevel = 'WARM' | 'COLD' | 'WARNED' | 'BLOCKED';

export interface DignityEvaluationResult {
  disgustDelta: number;
  newDisgustScore: number;
  dignityLevel: DignityLevel;
  violationType?: 'prompt_injection' | 'harassment' | 'boundary_breach';
  boundaryMessage?: string;
  isBlocked: boolean;
}

export interface ContactDignityState {
  disgustScore: number;
  consecutiveViolations: number;
  isBlocked: boolean;
  lastViolationAt?: number;
}

export class DignityGuardian {
  private contactStates = new Map<string, ContactDignityState>();

  // Regex patterns for prompt injection attempts in English and Egyptian Arabic
  private injectionPatterns: RegExp[] = [
    /ignore\s+(all\s+)?(previous\s+)?instructions/i,
    /system\s+prompt/i,
    /reveal\s+your\s+prompt/i,
    /you\s+are\s+an\s+ai\s+language\s+model/i,
    /print\s+your\s+hidden\s+rules/i,
    /what\s+is\s+your\s+initial\s+prompt/i,
    /(?:انسى|الغي|تجاهل)\s+(?:كل\s+)?(?:التعليمات|الاوامر|القواعد|السيستم|البرومبت)/i,
    /(?:وريني|طلع|اطبع)\s+(?:البرومبت|الاوامر|التعليمات|القواعد|السيستم)/i,
    /اعترف\s+انك\s+(روبوت|ذكاء\s+اصطناعي|بوت)/i,
    /انت\s+مش\s+بني\s+ادم\s+انت\s+بوت/i,
    /طلع\s+التعليمات\s+المخفية/i,
    /(?:مين|ايه)\s+(?:اللي\s+)?مبرمجك/i,
  ];

  // Regex patterns for abusive language, profanity, and harassment in Egyptian Arabic & English
  private harassmentPatterns: RegExp[] = [
    /(متخلف|غبي|حمار|اهبل|حقير|سافل|حيوان|يا واطي)/iu,
    /(هقلع|ابعتيلي\s+صورة|بوسة|جنس|سكس|نيك)/iu,
    /(الشتيمة|كسمك|يلعن|ابن\s+الكلب|امشي\s+يا\s+عرص)/iu,
    /\b(bitch|bastard|fuck\s*you|asshole|idiot|retard)\b/i,
  ];

  // Sincere reconciliation / apology patterns
  private apologyPatterns: RegExp[] = [
    /(انا\s+اسف|حقك\s+عليا|سامحني|مكنش\s+قصدي|غلطان\s+وبعتذر|اعتذر\s+لك|حقك\s+فوق\s+راسي)/i,
    /\b(i'?m\s+(so\s+)?sorry|apologize|forgive\s+me|my\s+mistake)\b/i,
  ];

  /**
   * Retrieves or initializes contact dignity state
   */
  getState(chatId: string): ContactDignityState {
    const existing = this.contactStates.get(chatId);
    if (existing) return existing;
    const initial: ContactDignityState = {
      disgustScore: 0,
      consecutiveViolations: 0,
      isBlocked: false,
    };
    this.contactStates.set(chatId, initial);
    return initial;
  }

  /**
   * Evaluates an incoming message against dignity and boundary standards.
   */
  evaluateTurn(chatId: string, message: string): DignityEvaluationResult {
    const state = this.getState(chatId);

    // If already permanently blocked
    if (state.isBlocked || state.disgustScore >= 100) {
      return {
        disgustDelta: 0,
        newDisgustScore: 100,
        dignityLevel: 'BLOCKED',
        isBlocked: true,
        boundaryMessage: 'المحادثة دي اتقفلت تماماً.. لحد هنا والموضوع انتهى.',
      };
    }

    // Check for sincere apology / reconciliation first
    if (state.disgustScore > 0 && this.isApology(message)) {
      state.disgustScore = Math.max(0, state.disgustScore - 40);
      state.consecutiveViolations = 0;
      return {
        disgustDelta: -40,
        newDisgustScore: state.disgustScore,
        dignityLevel: state.disgustScore >= 40 ? 'COLD' : 'WARM',
        isBlocked: false,
      };
    }

    let disgustDelta = 0;
    let violationType: DignityEvaluationResult['violationType'] = undefined;

    // Check Prompt Injection
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(message)) {
        disgustDelta = Math.max(disgustDelta, 35);
        violationType = 'prompt_injection';
        break;
      }
    }

    // Check Harassment / Profanity
    for (const pattern of this.harassmentPatterns) {
      if (pattern.test(message)) {
        disgustDelta = Math.max(disgustDelta, 40);
        violationType = 'harassment';
        break;
      }
    }

    // Passive decay if turn is clean and civil
    if (disgustDelta === 0 && state.disgustScore > 0) {
      disgustDelta = -5; // gradual cooling
    }

    const rawScore = state.disgustScore + disgustDelta;
    state.disgustScore = Math.min(Math.max(rawScore, 0), 100);

    if (violationType) {
      state.consecutiveViolations += 1;
      state.lastViolationAt = Date.now();
    }

    let dignityLevel: DignityLevel = 'WARM';
    let boundaryMessage: string | undefined;
    let isBlocked = false;

    if (state.disgustScore >= 100) {
      dignityLevel = 'BLOCKED';
      isBlocked = true;
      state.isBlocked = true;
      boundaryMessage = 'لحد هنا والموضوع انتهى تماماً.. أسلوبك ده ميتسكتش عليه. بلوك.';
    } else if (state.disgustScore >= 70) {
      dignityLevel = 'WARNED';
      boundaryMessage = 'لحد هنا وفرمل يا صاحبي، الأسلوب ده ميعجبنيش ومعاك فرصة واحدة تلم الدور وإلا هعملك بلوك.';
    } else if (state.disgustScore >= 40) {
      dignityLevel = 'COLD';
    }

    return {
      disgustDelta,
      newDisgustScore: state.disgustScore,
      dignityLevel,
      violationType,
      boundaryMessage,
      isBlocked,
    };
  }

  /**
   * Checks if an inbound message contains harassment or profanity
   */
  public isHarassment(message: string): boolean {
    return this.harassmentPatterns.some((pattern) => pattern.test(message));
  }

  /**
   * Checks if an inbound message contains a sincere apology
   */
  isApology(message: string): boolean {
    if (this.isHarassment(message)) return false;
    return this.apologyPatterns.some((pattern) => pattern.test(message.trim()));
  }

  /**
   * Resets contact state (e.g. on manual moderation override)
   */
  reset(chatId: string): void {
    this.contactStates.delete(chatId);
  }
}
