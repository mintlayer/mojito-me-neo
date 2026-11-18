// Real-mode home bundle gate: the BTC row sums confirmed and unconfirmed
// sats over every derived address (not just the current receiving address),
// and an Esplora-shaped two-key balance body without a total key must not
// kill the home bundle. Runs against a scripted global fetch with real
// keyring derivation, fully offline.
//   npx tsx src/data/real/realWalletData.test.ts
import { strict as assert } from 'node:assert/strict';

import { createRealAccountContext } from './account';
import { createRealWalletData } from './realWalletData';
import { deriveMlAccount, mlAddressAt } from '../../keys/mlAccounts';
import { btcAddressAt, deriveBtcAccount } from '../../keys/BtcKeyring';

const INDEXER_BASE = 'http://localhost:39100/api/v2';
const BTC_BASE = 'http://localhost:39101/api/bitcoin';

const MNEMONIC = `${Array(23).fill('abandon').join(' ')} art`;

type StubResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
};

function jsonResponse(status: number, body: unknown): StubResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

async function main() {
  const words = MNEMONIC.split(' ');
  const mlAccount = await deriveMlAccount(words, 'mainnet');
  const btcAccount = await deriveBtcAccount(words, 'mainnet');
  const mlFunded = await mlAddressAt(mlAccount.xpub, 0, 0, 'mainnet');
  const btcFunded0 = await btcAddressAt(btcAccount, 0, 0);
  const btcFunded1 = await btcAddressAt(btcAccount, 0, 1);

  // Route by pathname: the Mintlayer indexer and the btc-api Esplora base
  // answer from separate fixture sets. Both BTC funded addresses return the
  // two-key Esplora body without a total key; funds sit on receiving index
  // 0 and 1, so the current receiving address (index 2) holds nothing.
  const stubFetch = async (url: string): Promise<StubResponse> => {
    const path = new URL(url).pathname;
    if (path.startsWith('/api/v2/address/')) {
      const address = decodeURIComponent(path.slice('/api/v2/address/'.length));
      if (address === mlFunded) {
        return jsonResponse(200, {
          coin_balance: { atoms: '123000000000', decimal: '1.23' },
          locked_coin_balance: { atoms: '0', decimal: '0' },
          tokens: [],
          transaction_history: ['a'.repeat(64)],
        });
      }
      return jsonResponse(404, { error: 'AddressNotFound' });
    }
    if (path.startsWith('/api/bitcoin/address/')) {
      const rest = path.slice('/api/bitcoin/address/'.length);
      const address = decodeURIComponent(rest.replace(/\/balance$/, ''));
      if (rest.endsWith('/balance')) {
        if (address === btcFunded0) return jsonResponse(200, { confirmed: 150000000, unconfirmed: 2500 });
        if (address === btcFunded1) return jsonResponse(200, { confirmed: 100000000, unconfirmed: 0 });
        return jsonResponse(200, { confirmed: 0, unconfirmed: 0 });
      }
      const txCount = address === btcFunded0 ? 2 : address === btcFunded1 ? 3 : 0;
      return jsonResponse(200, {
        chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: txCount },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
      });
    }
    throw new Error(`no fixture for ${path}`);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch as unknown as typeof fetch;
  const context = createRealAccountContext({
    network: 'mainnet',
    indexerBase: INDEXER_BASE,
    btcBase: BTC_BASE,
    deriveXpubs: async () => ({ mlXpub: mlAccount.xpub, btcXpub: btcAccount.xpub }),
  });
  const data = createRealWalletData(context);
  try {
    // BTC sums across both funded addresses: 150000000 + 2500 + 100000000
    // sats = 2.500025 BTC, tolerating the missing total key on every body.
    const balances = await data.getAssetBalances();
    assert.equal(balances.BTC, '2.500025 BTC');
    assert.equal(balances.ML, '1.23 ML');

    // The home bundle survives: portfolio total and asset rows render with
    // the mock prices per R1 (ML 0.342, BTC 96420.32).
    const portfolio = await data.getPortfolio();
    assert.ok(Number(portfolio.total.replace(/,/g, '')) > 0);
    const assets = await data.getAssets();
    const btcRow = assets.find((row) => row.sym === 'BTC');
    assert.ok(btcRow, 'btc asset row missing');
    assert.equal(btcRow.amt, 2.500025);
    assert.equal(btcRow.value, 2.500025 * 96420.32);
    const mlRow = assets.find((row) => row.sym === 'ML');
    assert.ok(mlRow, 'ml asset row missing');
    assert.equal(mlRow.amt, 1.23);
    assert.deepEqual(await data.getNfts(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('realWalletData: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
