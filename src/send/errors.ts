// UI-safe copy for the send flow's typed failures (spec M3: error taxonomy
// with i18n copy, never raw server text). Pure mapping from the typed
// validation errors of this module; SendError mapping lands with the
// builders and the screen wiring.
import { t } from '../i18n';
import type { AddressError, AmountInputError } from './validation';

export function addressErrorCopy(e: AddressError): string {
  if (e.kind === 'wrongChain') return t('send.to.error.wrongChain');
  if (e.kind === 'wrongNetwork') return t('send.to.error.wrongNetwork', { network: e.expected });
  return t('send.to.error.malformed');
}

export function amountErrorCopy(e: AmountInputError): string {
  return t(e === 'tooManyDecimals' ? 'send.amount.error.tooManyDecimals' : 'send.amount.error.parse');
}
