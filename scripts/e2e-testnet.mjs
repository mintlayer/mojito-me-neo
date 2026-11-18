// Testnet E2E demo harness (spec M3 deliverable 11): derives both accounts
// from a phrase, funds via a faucet, then quotes, builds, signs, broadcasts
// and tracks one BTC send riding the same send service the app runs
// (createRealSend over the real broadcast provider, an in-memory address
// manager and the seeded KeySession closure shape). Headless thin harness.
// Runs under tsx because the service is TypeScript: npx tsx scripts/e2e-testnet.mjs
//
// BTC-ONLY status (decisions.md R6 / action items A1, A2): the Mintlayer-
// operated testnet indexer URL is not documented (A2) and the ML broadcast
// switch needs the A1 submission endpoint, so there is no ML leg here yet.
// The BTC leg is fully real on scure and needs MOJITO_BTC_BASE (btc-api
// testnet deployment).
//
// Environment:
//   MOJITO_BTC_BASE       btc-api testnet base (Esplora shape, F13)
//   MOJITO_PHRASE         BIP39 phrase (default: the public abandon vector;
//                         never put a funded real phrase in an env var)
//   MOJITO_TO             recipient address (default: derived change addr)
//   MOJITO_AMOUNT_BTC     amount in BTC (default 0.00005)
//
// Exit codes: 0 success, 2 config pending (btc base), 3 unfunded, 1 failure.
//
// ── M4 scripted atomic swap counterparty (spec M4 acceptance) ────────────
// The BTC side of the ML<->BTC HTLC swap demo runs OUTSIDE the wallet in v1
// (custom BTC HTLC script construction is unproven in-repo; see
// missing-architecture gap 2). The scripted counterparty flow, with the
// shorter-timelock rule enforced by the app's UI guards
// (src/trade/priceGuards.checkTimelockRule, TIMELOCK_RULE in
// src/trade/htlc.ts), is:
//   1. INITIATOR (app, real mode): generate the 32-byte preimage with the
//      native secure random, share ONLY SHA-256(preimage) off-band, lock ML
//      via src/trade/htlc.ts initiate() with refund_timelock = 48h
//      (172800s) and the counterparty's spend address/pubkey.
//   2. COUNTERPARTY (this script, external tooling): build and broadcast a
//      BTC HTLC paying the same SHA-256 hash with a SHORTER timelock
//      (24h = 86400s; the guard refuses any offer where
//      btcSeconds * 2 > mlSeconds). The lock script is a prebuilt
//      transaction generated with external Bitcoin tooling - the demo never
//      fabricates one in-app.
//   3. INITIATOR: claim the BTC HTLC by revealing the preimage in the
//      witness (the secret becomes public on Bitcoin).
//   4. COUNTERPARTY: read the preimage from the BTC claim (btc-api
//      GET tx/:txid/hex plus witness script parse), then claim the
//      Mintlayer HTLC via src/trade/htlc.ts claim() with the revealed
//      secret; extractSecret() round-trips the raw claim bytes through the
//      bindings extraction.
//   5. REFUND: if the counterparty never locks, the initiator reclaims via
//      htlc.refund() after the ML timelock expiry (the flow refuses typed
//      with not-expired before it).
// The sessions survive restarts via src/trade/swapSession.ts (secret hash
// only; the preimage stays in memory, hence the keep-open warning).

const btcBase = process.env.MOJITO_BTC_BASE?.replace(/\/+$/, '') ?? null;
const phrase = process.env.MOJITO_PHRASE ?? 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const amountBtc = process.env.MOJITO_AMOUNT_BTC ?? '0.00005';

const log = (...parts) => console.log(...parts);

async function main() {
  const { deriveBtcAccount, btcAddressAt } = await import('../src/keys/BtcKeyring.ts');
  const { deriveMlAccount, mlAddressAt } = await import('../src/keys/mlAccounts.ts');
  const { mnemonicToSeedSync } = await import('../src/keys/bip39.ts');
  const { BtcChainService } = await import('../src/data/btc/BtcChainService.ts');
  const { createAddressManager } = await import('../src/data/addresses/AddressManager.ts');
  const { createBroadcastProvider } = await import('../src/data/providers/BroadcastProvider.ts');
  const { TxTracker } = await import('../src/send/TxTracker.ts');
  const { createRealSend } = await import('../src/data/real/realSend.ts');
  const { SendError } = await import('../src/send/errors.ts');
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

  const amount = parseSendAmount(amountBtc, 8);
  if (!amount.ok) {
    log('MOJITO_AMOUNT_BTC is not a valid decimal amount:', amountBtc);
    process.exit(1);
  }
  const amountSat = BigInt(amount.atoms);
  const changeAddress = await btcAddressAt(btcAccount, 1, 0);
  const to = process.env.MOJITO_TO ?? changeAddress;

  // The app's send service over this process's accounts: the in-memory
  // address manager stands in for AsyncStorage, the real broadcast provider
  // posts the configured btc-api route, and the seed lives only inside the
  // withSeed closure exactly like the vault session does on device.
  const btc = new BtcChainService(btcBase, { retries: 1 });
  const manager = createAddressManager({
    network,
    load: async () => ({}),
    save: async () => {},
    derive: {
      ml: async (branch, index) => mlAddressAt(mlAccount.xpub, branch, index, network),
      btc: async (branch, index) => btcAddressAt(btcAccount, branch, index),
    },
  });
  const provider = createBroadcastProvider({ mode: 'real', broadcastBase: null, indexerBase: null, btcBase });
  const seed = mnemonicToSeedSync(words);
  const send = createRealSend({
    context: {
      cfg: {
        network,
        indexerBase: null,
        btcBase,
        deriveXpubs: async () => ({ mlXpub: mlAccount.xpub, btcXpub: btcAccount.xpub }),
      },
      ensureAccount: async () => ({ manager, balance: null, nfts: null, activity: null, btc }),
      requireIndexerBase: () => {},
      indexer: null,
      btc,
    },
    broadcastBase: null,
    loadBindings: () => {
      throw new Error('the BTC leg never loads the ML bindings');
    },
    broadcast: provider,
    // The harness tracks by polling txStatus below, so the tracker's own
    // loop stays inert.
    tracker: new TxTracker(provider, { timers: { set: () => 0, clear: () => {} } }),
    withSession: async (fn) => fn({ withSeed: (run) => run(seed) }),
  });

  // Friendly unfunded check over every managed address (the service funds
  // across them, so a balance on one address alone would lie).
  let totalSat = 0n;
  const managed = await manager.allAddresses('btc');
  for (const address of managed) totalSat += BigInt((await btc.balance(address)).totalSat);
  log(`BTC balance across ${managed.length} managed address(es): ${totalSat} sat`);
  if (totalSat < amountSat) {
    log('The derived BTC addresses are unfunded for this amount.');
    log('Fund one from a testnet faucet, then rerun. Faucet tips:');
    log('  https://faucet.mintlayer.org dispenses Mintlayer testnet ML;');
    log('  for BTC testnet use any tb1-capable faucet (e.g. mempool space testnet faucet).');
    process.exit(3);
  }

  // Review first (the app flow): the standard-tier quote is displayed and
  // its rate pins the send, so the signed fee is the reviewed fee.
  const quotes = await send.quoteBtc({ to, amountDecimal: amountBtc });
  const reviewed = quotes.standard;
  log(`plan: fee ${reviewed.feeDecimal} BTC at ${reviewed.satPerVbyte} sat/vB (fallback: ${reviewed.rateIsFallback}), vsize ${reviewed.sizeBytes}`);
  log(`sending ${amountSat} sat to ${to} (change to the next branch 1 address)`);

  let result;
  try {
    result = await send.sendBtc({
      to,
      amountDecimal: amountBtc,
      tier: 'standard',
      satPerVbyte: reviewed.satPerVbyte,
      rateIsFallback: reviewed.rateIsFallback,
    });
  } catch (e) {
    if (e instanceof SendError && e.kind === 'insufficient-funds') {
      log('The send failed typed insufficient-funds (spendable balance below amount plus fee).');
      process.exit(3);
    }
    throw e;
  }
  log(`broadcast accepted: ${result.txId}`);
  if (result.warning) log('note: post-send bookkeeping failed locally; the transaction is still on the network.');

  log('tracking until confirmed (10s poll, up to 60 attempts)...');
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = await btc.txStatus(result.txId);
    if (status.confirmed) {
      log(`confirmed after ${attempt + 1} polls. Demo complete.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  log('still pending after the poll window; the tx id above stays valid.');
}

main().catch((e) => {
  console.error('E2E failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
