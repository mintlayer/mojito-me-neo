// Testnet E2E demo harness (spec M3 deliverable 11): derives both accounts
// from a phrase, funds via a faucet, then plans, builds, signs, broadcasts
// and tracks one send using the same builder code paths the app runs
// (headless thin harness). Runs under tsx because the builders are
// TypeScript: npx tsx scripts/e2e-testnet.mjs
//
// BLOCKED status (decisions.md R6 / action item A2): the Mintlayer-operated
// testnet indexer URL is not documented, so the ML legs need
// MOJITO_INDEXER_BASE (self-hosted testnet indexer, gap 6 option B) to run.
// The BTC leg is fully real on scure and needs MOJITO_BTC_BASE (btc-api
// testnet deployment). ML signing additionally needs the native bindings
// call-through, which only exists inside a dev build on a device: the
// script reports that honestly instead of reimplementing ML signing here.
//
// Environment:
//   MOJITO_INDEXER_BASE   testnet indexer base (A2 pending; self-hosted ok)
//   MOJITO_BTC_BASE       btc-api testnet base (Esplora shape, F13)
//   MOJITO_PHRASE         BIP39 phrase (default: the public abandon vector;
//                         never put a funded real phrase in an env var)
//   MOJITO_TO             recipient address (default: derived change addr)
//   MOJITO_AMOUNT_BTC     amount in BTC (default 0.00005)
//
// Exit codes: 0 success, 2 config pending (A2 / btc base), 3 unfunded, 1 failure.

const indexerBase = process.env.MOJITO_INDEXER_BASE?.replace(/\/+$/, '') ?? null;
const btcBase = process.env.MOJITO_BTC_BASE?.replace(/\/+$/, '') ?? null;
const phrase = process.env.MOJITO_PHRASE ?? 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const amountBtc = process.env.MOJITO_AMOUNT_BTC ?? '0.00005';

const log = (...parts) => console.log(...parts);

if (indexerBase === null) {
  log('M3 testnet E2E is BLOCKED on action item A2 (decisions.md R6):');
  log('the Mintlayer-operated testnet indexer URL is not documented yet.');
  log('Stand up a self-hosted testnet indexer (gap 6 option B) and set');
  log('MOJITO_INDEXER_BASE, or run the BTC-only leg with MOJITO_BTC_BASE.');
  if (btcBase === null) process.exit(2);
}

async function main() {
  const { deriveBtcAccount, btcAddressAt } = await import('../src/keys/BtcKeyring.ts');
  const { deriveMlAccount, mlAddressAt } = await import('../src/keys/mlAccounts.ts');
  const { mnemonicToSeedSync } = await import('../src/keys/bip39.ts');
  const { BtcChainService } = await import('../src/data/btc/BtcChainService.ts');
  const { BtcTxBuilder } = await import('../src/send/BtcTxBuilder.ts');
  const { parseSendAmount } = await import('../src/send/validation.ts');

  const network = 'testnet';
  const words = phrase.trim().split(/\s+/);

  log(`deriving accounts for a ${words.length}-word phrase on ${network}`);
  const mlAccount = await deriveMlAccount(words, network);
  const btcAccount = await deriveBtcAccount(words, network);
  const mlReceive = await mlAddressAt(mlAccount.xpub, 0, 0, network);
  const btcReceive = await btcAddressAt(btcAccount, 0, 0);
  log('  ML receiving (M3 faucet target):', mlReceive);
  log('  BTC receiving:', btcReceive);

  if (btcBase === null) {
    log('BTC leg skipped: no MOJITO_BTC_BASE configured.');
    process.exit(2);
  }

  const btc = new BtcChainService(btcBase, { retries: 1 });
  const balance = await btc.balance(btcReceive);
  log(`BTC balance: confirmed ${balance.confirmedSat} sat, unconfirmed ${balance.unconfirmedSat} sat`);

  const amount = parseSendAmount(amountBtc, 8);
  if (!amount.ok) {
    log('MOJITO_AMOUNT_BTC is not a valid decimal amount:', amountBtc);
    process.exit(1);
  }
  const amountSat = BigInt(amount.atoms);
  const changeAddress = await btcAddressAt(btcAccount, 1, 0);
  const to = process.env.MOJITO_TO ?? changeAddress;
  log(`sending ${amountSat} sat to ${to} (change to ${changeAddress})`);

  if (BigInt(balance.totalSat) < amountSat) {
    log('The derived BTC address is unfunded for this amount.');
    log('Fund it from a testnet faucet, then rerun. Faucet tips:');
    log('  https://faucet.mintlayer.org dispenses Mintlayer testnet ML;');
    log('  for BTC testnet use any tb1-capable faucet (e.g. mempool space testnet faucet).');
    process.exit(3);
  }

  const builder = new BtcTxBuilder({
    network,
    utxos: btc,
    rateSource: async (tier) => {
      try {
        const estimates = await btc.feeEstimates();
        const target = { economy: '6', standard: '3', fast: '1' }[tier];
        const rate = estimates[target];
        if (typeof rate === 'number' && rate > 0) return { satPerVbyte: rate, fallback: false };
      } catch {
        // fall through to the flagged fallback
      }
      log('fee-estimates unreachable: using the flagged fixed fallback 6 sat/vB');
      return { satPerVbyte: 6, fallback: true };
    },
    changeAddress,
  });

  const plan = await builder.plan({ accountXpub: btcAccount.xpub, from: btcReceive, to, amountSat, tier: 'standard' });
  log(`plan: fee ${plan.feeSat} sat at ${plan.satPerVbyte} sat/vB (fallback: ${plan.rateIsFallback}), vsize ${plan.vsize}`);

  // Headless harness: the seed is already in this process, so the closure
  // shape of KeySession.withSeed is simulated without touching the vault.
  const seed = mnemonicToSeedSync(words);
  const signed = await builder.buildAndSign({ seed, accountXpub: btcAccount.xpub, from: btcReceive, to, amountSat, tier: 'standard' });
  log(`signed tx ${signed.txid} (${signed.hex.length / 2} bytes, fee ${signed.feeSat} sat)`);

  log('broadcasting via btc-api POST tx...');
  const txid = await btc.broadcastTx(signed.hex);
  log(`broadcast accepted: ${txid}`);

  log('tracking until confirmed (10s poll, up to 60 attempts)...');
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = await btc.txStatus(txid);
    if (status.confirmed) {
      log(`confirmed after ${attempt + 1} polls. Demo complete.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  log('still pending after the poll window; the tx id above stays valid.');
}

await main().catch((e) => {
  console.error('E2E failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
