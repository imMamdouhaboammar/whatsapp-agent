export function scrubCredentials(text: string): string {
  if (!text) return text;
  let scrubbed = text;

  // 1. Common API keys (OpenAI sk-, Google AIza, Anthropic sk-ant-, GitHub ghp_, etc.)
  scrubbed = scrubbed.replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z-_]{35}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)\b/g, '[REDACTED_CREDENTIAL]');

  // 2. Bearer tokens and Authorization headers
  scrubbed = scrubbed.replace(/(?:Bearer\s+|token\s*[:=]\s*)[A-Za-z0-9_.-]{20,}/gi, '[REDACTED_CREDENTIAL]');

  // 3. Passwords / Secrets in key-value patterns (Latin & Arabic words for password/secret)
  scrubbed = scrubbed.replace(/(?:password|secret|passwd|الباسورد|باسورد|كلمة[\s_]*المر(?:ور)?|رمز[\s_]*الس(?:ري?)?)(?:\s*[:=]\s*|\s+is\s+|\s+(?:الخاصة\s+بي\s+هي|هي|هو)\s+)(\S+)/gi, (match, val: string) => {
    return match.replace(val, '[REDACTED_CREDENTIAL]');
  });

  // 4. OTP / Verification codes (4-8 digits accompanied by code/otp/رمز)
  scrubbed = scrubbed.replace(/(?:otp|code|pin|رمز(?:\s+التأكيد)?|كود)(?:\s*[:=]\s*|\s+is\s+|\s+)(\b\d{4,8}\b)/gi, (match, val: string) => {
    return match.replace(val, '[REDACTED_CREDENTIAL]');
  });

  // 5. Credit card numbers (13 to 16 digits with optional spaces or dashes)
  scrubbed = scrubbed.replace(/\b(?:\d{4}[ -]?){3}\d{1,4}\b/g, '[REDACTED_CREDENTIAL]');

  return scrubbed;
}
