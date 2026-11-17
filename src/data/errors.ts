// UI-safe copy for provider data failures: typed errors map to i18n keys,
// raw server bodies and stack traces never reach a screen.
import { t } from '../i18n';
import { IndexerError } from './ml/IndexerClient';
import { PriceUnavailableError } from './prices/PriceProvider';

export function dataErrorCopy(e: unknown): string {
  if (e instanceof IndexerError) {
    return e.kind === 'http'
      ? t('errors.indexer.http', { status: e.status ?? 0 })
      : t('errors.indexer.network');
  }
  if (e instanceof PriceUnavailableError) return t('errors.price.unavailable');
  return t('common.error.generic');
}
