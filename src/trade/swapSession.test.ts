// Swap session store gate (spec M4 testing section): state machine
// transitions, persistence round-trip, corrupt-row dropping and the
// no-preimage guarantee (only the secret hash ever persists).
//   tsx src/trade/swapSession.test.ts
import { strict as assert } from 'node:assert/strict';

import { bytesToHex } from '@noble/hashes/utils.js';

import { canTransition, assertTransition, createSwapSessionStore, parseSwapSessions, type SwapSessionRow, type SwapState } from './swapSession';
import type { HtlcOffer } from './htlc';

const OFFER: HtlcOffer = {
  role: 'initiator',
  giveChain: 'ml',
  giveAtoms: '2000000000000',
  wantAtoms: '560000000000000',
  secretHash: new Uint8Array(32).fill(0x21),
  timelockSeconds: 172800,
};

const row = (overrides?: Partial<SwapSessionRow>): SwapSessionRow => ({
  id: 'swap-1',
  offer: OFFER,
  secretHashHex: bytesToHex(new Uint8Array(32).fill(0x21)),
  spendAddress: 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl',
  refundAddress: 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl',
  lockTxHex: 'ee0102ff01',
  state: 'offered',
  txIds: [],
  updatedAt: 1700000000000,
  ...overrides,
});

/** Scripted storage backend recording writes (offline; no AsyncStorage). */
function memoryStorage() {
  const state: { json: string | null } = { json: null };
  return {
    storage: {
      async load() {
        return state.json;
      },
      async save(json: string) {
        state.json = json;
      },
    },
    json: () => state.json,
  };
}

async function main() {
  // Transition table: the happy path and the honest alternates.
  assert.ok(canTransition('offered', 'locked'));
  assert.ok(canTransition('offered', 'refunded'), 'a stranded offered row refunds from its stored lock bytes');
  assert.ok(canTransition('locked', 'claiming'));
  assert.ok(canTransition('locked', 'refunded'));
  assert.ok(canTransition('locked', 'expired'));
  assert.ok(canTransition('claiming', 'settled'));
  assert.ok(canTransition('claiming', 'refunded'));
  assert.ok(!canTransition('offered', 'settled'), 'a swap never skips the lock');
  assert.ok(!canTransition('settled', 'claiming'), 'terminal states are terminal');
  assert.throws(() => assertTransition('expired', 'locked'), /invalid swap transition/);

  // The screen's split initiate: the offered row carries the lock bytes
  // BEFORE any broadcast, then transitions offered -> locked on the
  // broadcast answer, and the bytes rest through the transition.
  {
    const backend = memoryStorage();
    const store = createSwapSessionStore(backend.storage);
    const offered = row({ state: 'offered', lockTxHex: 'ee0102ff01' });
    await store.save(offered);
    assert.equal(JSON.parse(backend.json() ?? '[]')[0].state, 'offered', 'the offered row with the lock bytes is at rest');
    assertTransition(offered.state, 'locked');
    await store.save({ ...offered, state: 'locked', txIds: [offered.id], updatedAt: offered.updatedAt + 1 });
    const saved = await store.get(offered.id);
    assert.equal(saved?.state, 'locked');
    assert.equal(saved?.lockTxHex, 'ee0102ff01', 'the lock tx bytes rest through the offered -> locked transition');
  }

  // Persistence round-trip over the scripted backend.
  {
    const backend = memoryStorage();
    const store = createSwapSessionStore(backend.storage);
    await store.save(row({ state: 'offered' }));
    await store.save(row({ id: 'swap-2', state: 'locked', txIds: ['aa'.repeat(32)], updatedAt: 1700000001000 }));
    const all = await store.all();
    assert.equal(all.length, 2);
    assert.equal(all[0].id, 'swap-2', 'newest first');
    assert.equal(all[0].state, 'locked');
    const one = await store.get('swap-1');
    assert.equal(one?.state, 'offered');
    assert.equal(await store.get('missing'), null);

    // Restart path: a fresh store over the same backend restores rows,
    // including the lock tx bytes the claim and refund decodes need.
    const reopened = createSwapSessionStore(backend.storage);
    const restored = await reopened.all();
    assert.equal(restored.length, 2);
    assert.equal(restored.find((r) => r.id === 'swap-1')?.lockTxHex, 'ee0102ff01');
    await reopened.remove('swap-1');
    assert.deepEqual((await reopened.all()).map((r) => r.id), ['swap-2']);
  }

  // The persisted JSON carries the secret hash only: the raw preimage
  // bytes must never appear in storage, and the offer rides its scalar
  // persisted form (no byte fields that JSON would mangle into objects).
  {
    const backend = memoryStorage();
    const store = createSwapSessionStore(backend.storage);
    await store.save(row());
    const json = backend.json() ?? '';
    assert.ok(json.includes(bytesToHex(new Uint8Array(32).fill(0x21))), 'the secret hash persists');
    assert.ok(!json.includes('preimage'), 'no preimage field ever persists');
    assert.ok(!('secret' in JSON.parse(json)[0].offer));
    const savedOffer = JSON.parse(json)[0].offer;
    assert.deepEqual(Object.keys(savedOffer).sort(), ['giveAtoms', 'giveChain', 'role', 'timelockSeconds', 'wantAtoms'], 'the offer persists in its scalar form');
  }

  // Round-trip: the restored row rebuilds the secret hash bytes from the
  // persisted hex (Uint8Array, not a JSON object map).
  {
    const backend = memoryStorage();
    const store = createSwapSessionStore(backend.storage);
    await store.save(row({ state: 'locked' }));
    const restored = (await store.all())[0];
    assert.ok(restored.offer.secretHash instanceof Uint8Array, 'secretHash is rebuilt as bytes');
    assert.equal(bytesToHex(restored.offer.secretHash), bytesToHex(new Uint8Array(32).fill(0x21)));
    assert.equal(restored.offer.timelockSeconds, 172800);
  }

  // Corrupt stores drop bad rows instead of wedging the machine: garbage
  // JSON, non-rows, a bad secret-hash shape, a bad lock-tx shape, an
  // unknown state.
  assert.deepEqual(parseSwapSessions(null), []);
  assert.deepEqual(parseSwapSessions('not json'), []);
  assert.deepEqual(parseSwapSessions('{"a":1}'), []);
  const good = row();
  const badHash = row({ id: 'bad-hash', secretHashHex: 'zz' });
  const badLockTx = row({ id: 'bad-locktx', lockTxHex: 'not-hex!' });
  const badState = row({ id: 'bad-state', state: 'cancelled' as SwapState });
  const badTimelock = row({ id: 'bad-timelock', offer: { ...OFFER, timelockSeconds: Number.NaN } });
  const badOfferShape = row({ id: 'bad-offer', offer: { ...OFFER, role: 'attacker' as never } });
  const tooManyTxIds = row({ id: 'bad-txids', txIds: Array.from({ length: 20 }, () => 'aa') });
  const mixed = JSON.stringify([good, badHash, badLockTx, badState, badTimelock, badOfferShape, tooManyTxIds]);
  const parsed = parseSwapSessions(mixed);
  assert.deepEqual(
    parsed.map((r) => r.id),
    ['swap-1'],
  );
  // A tampered offer object carrying a mangled byte field is normalized:
  // the rebuilt bytes come from secretHashHex, not from the stored junk.
  const tampered = JSON.parse(JSON.stringify(row({ id: 'tampered' })));
  tampered.offer.secretHash = { 0: 1 };
  const normalized = parseSwapSessions(JSON.stringify([tampered]))[0];
  assert.equal(bytesToHex(normalized.offer.secretHash), bytesToHex(new Uint8Array(32).fill(0x21)));
  // Rows persisted before the lock-tx record stay loadable (optional
  // field); they just cannot refund (the screen guards on the bytes).
  const legacy = JSON.parse(JSON.stringify(row({ id: 'legacy' })));
  delete legacy.lockTxHex;
  assert.equal(parseSwapSessions(JSON.stringify([legacy])).length, 1);
  // The retired spendPubkeyHex column does not resurrect from a legacy
  // store: parse rebuilds rows from the validated fields only.
  const legacyKey = JSON.parse(JSON.stringify(row({ id: 'legacy-key' })));
  legacyKey.spendPubkeyHex = '02'.repeat(33);
  const stripped = parseSwapSessions(JSON.stringify([legacyKey]))[0];
  assert.ok(stripped, 'the legacy row still loads');
  assert.ok(!('spendPubkeyHex' in stripped), 'the retired spend pubkey column is stripped on load');
  assert.equal(Object.keys(stripped).sort().join(','), 'id,lockTxHex,offer,refundAddress,secretHashHex,spendAddress,state,txIds,updatedAt');

  // Session cap: a hostile store cannot force unbounded memory.
  const many = Array.from({ length: 40 }, (_, i) => row({ id: `s${i}` }));
  assert.equal(parseSwapSessions(JSON.stringify(many)).length, 32);

  // Unknown states refuse to save.
  {
    const backend = memoryStorage();
    const store = createSwapSessionStore(backend.storage);
    await assert.rejects(() => store.save(row({ state: 'cancelled' as SwapState })), /unknown swap state/);
  }

  console.log('swapSession: ok');
}

main();
