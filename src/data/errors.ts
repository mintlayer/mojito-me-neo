// UI-safe copy for provider data failures: typed errors map to i18n keys,
// raw server bodies and stack traces never reach a screen.
import { t } from '../i18n';
import { currentNetwork, endpointsFor } from '../config/endpoints';
import { IndexerError } from './ml/IndexerClient';
import { PriceUnavailableError } from './prices/PriceProvider';

/** True when the active network has no indexer base configured (the pending
 *  testnet index, action item A2): data failures there are by design, not a
 *  connection problem on the user's side. */
function indexerUnconfigured(): boolean {
  return endpointsFor(currentNetwork()).indexerBase === null;
}

export function dataErrorCopy(e: unknown): string {
  if (e instanceof IndexerError) {
    // An unconfigured base throws transport before any request exists, so
    // that combination is the "testnet data isn't connected yet" state,
    // never an offline accusation against a working connection.
    if (e.kind === 'transport' && indexerUnconfigured()) return t('errors.indexer.testnet');
    return e.kind === 'http'
      ? e.status !== undefined
        ? t('errors.indexer.http', { status: e.status })
        : t('errors.indexer.httpGeneric')
      : t('errors.indexer.network');
  }
  if (e instanceof PriceUnavailableError) return t('errors.price.unavailable');
  return t('common.error.generic');
}
