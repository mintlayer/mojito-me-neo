// UI-safe copy for the send flow's typed failures (spec M3: error taxonomy
// with i18n copy, never raw server text). Pure mapping: typed errors in,
// localized strings out; details only ride the rejected copy where the spec
// names a {detail} slot.
import { t } from '../i18n';
import { dataErrorCopy } from '../data/errors';
import type { AddressError, AmountInputError } from './validation';

export function addressErrorCopy(e: AddressError): string {
  if (e.kind === 'wrongChain') return t('send.to.error.wrongChain');
  if (e.kind === 'wrongNetwork') return t('send.to.error.wrongNetwork', { network: e.expected });
  return t('send.to.error.malformed');
}

export function amountErrorCopy(e: AmountInputError): string {
  return t(e === 'tooManyDecimals' ? 'send.amount.error.tooManyDecimals' : 'send.amount.error.parse');
}

export type SendErrorKind =
  | 'invalid-address'
  | 'insufficient-funds'
  | 'dust'
  | 'broadcast-disabled'
  | 'broadcast-failed'
  | 'timeout'
  | 'rejected'
  | 'bindings';

/** Typed failure of one send pipeline step (plan, build, sign, broadcast). */
export class SendError extends Error {
  constructor(
    readonly kind: SendErrorKind,
    readonly detail?: string,
  ) {
    super(detail ?? kind);
    this.name = 'SendError';
  }
}

export function sendErrorCopy(e: unknown): string {
  if (e instanceof SendError) {
    switch (e.kind) {
      case 'invalid-address':
        return t('send.to.error.malformed');
      case 'insufficient-funds':
        return t('send.amount.error.insufficient');
      case 'dust':
        return t('send.amount.error.dust');
      case 'broadcast-disabled':
        return t('send.error.broadcast.disabled');
      case 'broadcast-failed':
        return t('send.error.broadcast.failed');
      case 'timeout':
        return t('send.error.timeout');
      case 'rejected':
        return t('send.error.rejected', { detail: e.detail ?? '' });
      case 'bindings':
        return t('send.error.bindings');
    }
  }
  // Chain read failures during planning keep the shared provider copy.
  return dataErrorCopy(e);
}
