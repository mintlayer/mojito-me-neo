// UI-safe copy for the send flow's typed failures (spec M3: error taxonomy
// with i18n copy, never raw server text). Pure mapping: typed errors in,
// localized strings out. Error details are diagnostics for the typed error
// object only; no kind renders a detail on screen.
import { t } from '../i18n';
import { dataErrorCopy } from '../data/errors';
import type { AddressError, AmountInputError } from './validation';

/** User-facing names for the wrong-network copy: raw hrp-style tokens
 *  (btc-testnet) must not surface verbatim; the ML side already carries a
 *  readable name in its kind. */
const NETWORK_LABELS: Record<string, string> = {
  'btc-mainnet': 'Bitcoin mainnet',
  'btc-testnet': 'Bitcoin testnet',
};

export function addressErrorCopy(e: AddressError): string {
  if (e.kind === 'wrongChain') return t('send.to.error.wrongChain');
  if (e.kind === 'wrongNetwork') return t('send.to.error.wrongNetwork', { network: NETWORK_LABELS[e.expected] ?? e.expected });
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
  | 'bindings'
  | 'busy'
  | 'txid-mismatch'
  | 'stale-fee';

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
        // Internal pipeline rejections (builder shape guards, amount
        // backstops): the typed detail stays diagnostics-only, the user
        // gets the generic copy per the no-raw-internals contract.
        return t('common.error.generic');
      case 'bindings':
        return t('send.error.bindings');
      case 'busy':
        return t('send.error.busy');
      case 'txid-mismatch':
        return t('send.error.txidMismatch');
      case 'stale-fee':
        return t('send.error.feeChanged');
    }
  }
  // The native facade rejects with a plain BindingsError object
  // ({ kind, detail }, modules/mojito-core), never a class instance across
  // the bridge, so the device-pending signing copy is mapped here by the
  // documented kind set (no collision: the data-layer errors use
  // transport/http/parse kinds, none of which appear in this set).
  if (isBindingsErrorShape(e)) return t('send.error.bindings');
  // Chain read failures during planning keep the shared provider copy.
  return dataErrorCopy(e);
}

/** The BindingsError kind set (modules/mojito-core/mintlayer), duck-typed. */
const BINDINGS_ERROR_KINDS = new Set([
  'invalid-mnemonic',
  'decoding',
  'signing',
  'sighash',
  'address-parse',
  'amount',
  'orders-v1-not-activated',
  'unknown',
]);

function isBindingsErrorShape(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const record = e as { kind?: unknown; detail?: unknown };
  return typeof record.kind === 'string' && BINDINGS_ERROR_KINDS.has(record.kind) && typeof record.detail === 'string';
}

/** True when the failure is the device-pending native signing module: the
 *  send screen keys its proactive ML note off this seam so the honest
 *  state surfaces with the first quote failure, not only at Confirm. */
export function isBindingsUnavailable(e: unknown): boolean {
  return (e instanceof SendError && e.kind === 'bindings') || isBindingsErrorShape(e);
}
