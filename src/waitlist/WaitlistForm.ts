// Card waitlist email layer (spec M5): the shared validation and redaction
// helpers every waitlist surface uses, plus the WaitlistForm state machine
// that drives the provider seam. The provider behind it is the v1
// LOCAL-ONLY store (R4) or the config-gated HTTP provider once the gap 4
// endpoint exists.
//
// TODO (SHIP BLOCKER, decision R4, 2026-11-17): the waitlist backend does
// not exist; v1 persistence is device-local. This MUST be replaced by a
// real backend before any production ship (specs/M5-card.md,
// decisions.md R4, missing-architecture gap 4).
import type { WaitlistProvider, WaitlistResult } from '../data/providers/types';

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

/**
 * One waitlist form's state machine (spec M5): idle -> submitting -> done |
 * duplicate | unavailable, with invalid parked before any provider call.
 * done always carries a position-or-null answer (null = graceful
 * no-position confirmation, e.g. the idempotent rejoin); duplicate carries
 * the address already on file so the screen can render the masked callout.
 * The machine owns the no-double-submit rule: a second submit while one is
 * in flight returns the submitting phase untouched.
 */
export class WaitlistForm {
  private readonly provider: WaitlistProvider;
  private raw = '';
  private phase: WaitlistPhase = 'idle';
  private storedEmail: string | null = null;
  private storedPosition: number | null = null;

  constructor(provider: WaitlistProvider) {
    this.provider = provider;
  }

  /** The trimmed, lowercased address the submit path sends. */
  get email(): string {
    return normalizeEmail(this.raw);
  }

  get currentPhase(): WaitlistPhase {
    return this.phase;
  }

  /** The email already on file after a duplicate refusal; the screen
   *  renders it through maskEmail(). Null while unknown. */
  get duplicateEmail(): string | null {
    return this.storedEmail;
  }

  /** Position from the successful join; null reads as the graceful
   *  no-position confirmation copy. */
  get joinedPosition(): number | null {
    return this.storedPosition;
  }

  /** Editing clears every non-flight outcome: a stale duplicate or failure
   *  never sits next to a new address. While a submit is in flight the
   *  draft still updates but the phase stays owned by that submit. */
  setEmail(raw: string): void {
    this.raw = raw;
    if (this.phase !== 'submitting') this.phase = 'idle';
  }

  validate(): EmailCheck {
    return checkEmail(this.raw);
  }

  /** Idle or failed states move to submitting and resolve to done,
   *  duplicate or unavailable. A provider throw (transport down) lands in
   *  unavailable exactly like a 503, with the draft left in the field. */
  async submit(): Promise<WaitlistPhase> {
    if (this.phase === 'submitting') return this.phase;
    if (checkEmail(this.raw) === 'invalid') {
      this.phase = 'invalid';
      return this.phase;
    }
    this.phase = 'submitting';
    let result: WaitlistResult;
    try {
      result = await this.provider.join(this.email);
    } catch {
      this.phase = 'unavailable';
      return this.phase;
    }
    if (result.ok) {
      this.storedPosition = result.position;
      this.storedEmail = null;
      this.phase = 'done';
      return this.phase;
    }
    if (result.reason === 'invalid') {
      this.phase = 'invalid';
      return this.phase;
    }
    if (result.reason === 'duplicate') {
      // One slot per install: surface the address already on file so the
      // screen can offer the confirmation view with the masked email. The
      // typed-in address is the fallback when the provider cannot report
      // one (the HTTP provider has no member-status route yet).
      try {
        const status = await this.provider.status();
        this.storedEmail = status.email ?? this.email;
        this.storedPosition = status.position;
      } catch {
        this.storedEmail = this.email;
      }
      this.phase = 'duplicate';
      return this.phase;
    }
    this.phase = 'unavailable';
    return this.phase;
  }

  /** Unavailable path only: any other phase is a no-op returning it. */
  async retry(): Promise<WaitlistPhase> {
    if (this.phase !== 'unavailable') return this.phase;
    return this.submit();
  }
}
