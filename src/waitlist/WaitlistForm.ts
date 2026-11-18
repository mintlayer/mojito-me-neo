// Card waitlist email layer (spec M5): the shared validation and redaction
// helpers every waitlist surface uses, so the RFC-ish rules and the masking
// exist exactly once. The WaitlistForm state machine below consumes them
// and drives the provider seam.
//
// TODO (SHIP BLOCKER, decision R4, 2026-11-17): the waitlist backend does
// not exist; v1 persistence is device-local (LOCAL-ONLY). This MUST be
// replaced by a real backend before any production ship (specs/M5-card.md,
// decisions.md R4, missing-architecture gap 4).
import type { WaitlistProvider } from '../data/providers/types';

export type WaitlistPhase = 'idle' | 'invalid' | 'submitting' | 'duplicate' | 'done' | 'unavailable';

export type EmailCheck = 'ok' | 'invalid';

/** RFC 5321 total address length cap. */
export const EMAIL_MAX_LENGTH = 254;

/** RFC 5321 local-part cap. */
const LOCAL_PART_MAX = 64;

/** Whitespace, ASCII control characters and markup delimiters are refused:
 *  the email is personal data that must never carry HTML or control bytes
 *  (spec M5 input hygiene). */
const EMAIL_FORBIDDEN = /[\u0000-\u001f\u007f\s<>"'`\\]/;

/** The submit-path spelling: trimmed and lowercased. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** RFC-ish check: exactly one @, non-empty local part and domain, RFC 5321
 *  length caps, no forbidden characters. Unicode local parts are accepted
 *  (normalizeEmail lowercases them). */
export function checkEmail(raw: string): EmailCheck {
  const email = normalizeEmail(raw);
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return 'invalid';
  const at = email.indexOf('@');
  if (at <= 0 || email.indexOf('@', at + 1) !== -1) return 'invalid';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > LOCAL_PART_MAX || domain.length === 0) return 'invalid';
  if (EMAIL_FORBIDDEN.test(email)) return 'invalid';
  return 'ok';
}

/** Status-UI redaction (spec M5 security note): mask the local part, keep
 *  the domain, so 'john.doe@example.com' renders 'j***@example.com'. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** Form state machine over the WaitlistProvider seam. The class lands with
 *  its transition tests in the M5 form commit; the CardScreen consumes it. */
export class WaitlistForm {
  private readonly provider: WaitlistProvider;

  constructor(provider: WaitlistProvider) {
    this.provider = provider;
  }
}
