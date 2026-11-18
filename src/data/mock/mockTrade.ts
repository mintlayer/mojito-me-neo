// Mock trade flows (R3 demo path, createMockSend pattern): the DEX, swap
// and bridge screens run the same shape in both modes. Mock mode returns
// deterministic demo ids after a delay and keeps every session in memory;
// no chain state is touched and nothing reads as a real settlement (the
// demo-data chip stays visible in mock mode, spec M4 honesty rules).
import { ASKS, BIDS } from '../../data';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { NetworkFlag } from '../../config/endpoints';
import type { BroadcastProvider } from '../providers/types';
import { DEFAULT_BOOK_DEPTH, type BookRow, type OrderBookService } from '../../trade/OrderBookService';
import { COIN_REF, type OrderData, type OrderFlows } from '../../trade/orders';
import type { HtlcFlows, HtlcOffer, HtlcSpend } from '../../trade/htlc';
import { createSwapSessionStore, type SwapSessionStorage, type SwapSessionStore } from '../../trade/swapSession';

/** Fixture book mapped onto the live-service row shape, so the DexScreen
 *  renders identical code in both modes. */
export function createMockOrderBookService(): OrderBookService {
  const toRows = (levels: { p: number; s: number }[]): BookRow[] => {
    let running = 0;
    return levels.slice(0, DEFAULT_BOOK_DEPTH).map((level) => {
      running += level.p * level.s;
      return { price: String(level.p), size: String(level.s), total: String(running) };
    });
  };
  const levels = async (base: string, quote: string, side: 'ask' | 'bid'): Promise<BookRow[]> => {
    void base;
    void quote;
    return side === 'ask' ? toRows(ASKS) : toRows(BIDS);
  };
  return { levels, last: async () => null };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic fake hex payload per params (mockSend pattern). */
function fakeId(seed: string): string {
  let h = 0x9e3779b9;
  let out = '';
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h ^ seed.charCodeAt(i), 0x01000193) + i) >>> 0;
  }
  for (let b = 0; b < 16; b++) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    out += ((h >>> 24) & 0xff).toString(16).padStart(2, '0');
  }
  return out.repeat(2).slice(0, 64);
}

function requireAtomAmount(value: string, what: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) === 0n) throw new Error(`${what} must be a positive atom string`);
  return value;
}

/** Demo order flows: full validation and the mock broadcast, results
 *  labelled demo by the fake deterministic ids. */
export function createMockOrderFlows(cfg: { broadcast: BroadcastProvider; network: NetworkFlag }): OrderFlows {
  const myOrders: OrderData[] = [];
  return {
    async createOrder({ giveTokenId, giveAtoms, askTokenId, askAtoms }) {
      requireAtomAmount(giveAtoms, 'give');
      requireAtomAmount(askAtoms, 'ask');
      const { txId } = await cfg.broadcast.broadcastMl(fakeId(`create:${giveTokenId}:${giveAtoms}:${askAtoms}:${cfg.network}`));
      const orderId = `mordr1demo${fakeId(`${txId}:${orderIdSeedCounter++}`).slice(0, 20)}`;
      myOrders.unshift({
        orderId,
        giveTokenId: giveTokenId === COIN_REF ? COIN_REF : giveTokenId,
        giveBalanceAtoms: giveAtoms,
        askTokenId,
        askBalanceAtoms: askAtoms,
        concludeDestination: '',
        nonce: null,
        frozen: false,
      });
      return { txId, orderId };
    },
    async fillOrder({ orderId, fillAtoms, destination }) {
      requireAtomAmount(fillAtoms, 'fill');
      void destination;
      const known = myOrders.find((order) => order.orderId === orderId);
      if (known && (known.frozen || (known.giveBalanceAtoms === '0' && known.askBalanceAtoms === '0'))) {
        throw new Error('order is not open');
      }
      const { txId } = await cfg.broadcast.broadcastMl(fakeId(`fill:${orderId}:${fillAtoms}`));
      return { txId };
    },
    async concludeOrder({ orderId }) {
      const known = myOrders.find((order) => order.orderId === orderId);
      if (known) {
        if (known.concludeDestination === '') throw new Error('demo order carries no conclude destination');
        known.giveBalanceAtoms = '0';
        known.askBalanceAtoms = '0';
      }
      const { txId } = await cfg.broadcast.broadcastMl(fakeId(`conclude:${orderId}`));
      return { txId };
    },
    async openOrders() {
      await delay(200);
      return [];
    },
    async myOrders() {
      await delay(200);
      return [...myOrders];
    },
  };
}

let orderIdSeedCounter = 0;

/** Demo HTLC flows: the swap session demo walks lock/claim/refund on the
 *  mock broadcaster with deterministic fake tx ids. */
export function createMockHtlcFlows(cfg: { broadcast: BroadcastProvider }): HtlcFlows {
  return {
    async initiate(offer: HtlcOffer, spend: HtlcSpend, refundAddress: string) {
      void spend;
      void refundAddress;
      requireAtomAmount(offer.giveAtoms, 'give');
      if (offer.secretHash.length !== 32) throw new Error('the secret hash must be 32 bytes');
      const { txId } = await cfg.broadcast.broadcastMl(fakeId(`htlc-lock:${offer.giveAtoms}`));
      // Demo lock bytes: the session persists them so the claim/refund
      // signatures match the real seam (the demo decode is a no-op).
      const lockTx = new Uint8Array(64).fill(0x1c);
      return { txId, lockTx, htlcOutpoint: { id: new Uint8Array(32).fill(0x0a), index: 0 } };
    },
    async claim(lockTx: Uint8Array, secret: Uint8Array) {
      void lockTx;
      if (secret.length !== 32) throw new Error('the preimage must be 32 bytes');
      const { txId } = await cfg.broadcast.broadcastMl(fakeId(`htlc-claim:${bytesToHex(lockTx.subarray(0, 8))}`));
      return { txId };
    },
    async refund(lockTx: Uint8Array) {
      const { txId } = await cfg.broadcast.broadcastMl(fakeId(`htlc-refund:${bytesToHex(lockTx.subarray(0, 8))}`));
      return { txId };
    },
    async extractSecret(rawSignedTx: Uint8Array, htlcOutpoint: { id: Uint8Array; index: number }) {
      void htlcOutpoint;
      return rawSignedTx.subarray(0, 32);
    },
  };
}

/** Memory-backed swap session storage for mock mode (sessions are demo
 *  state; they survive navigation but not a mock-mode restart, which the
 *  demo chip discloses anyway). */
export function createMockSwapSessionStorage(): SwapSessionStorage {
  let json: string | null = null;
  return {
    async load() {
      return json;
    },
    async save(next: string) {
      json = next;
    },
  };
}

export function createMockSwapSessionStore(): SwapSessionStore {
  return createSwapSessionStore(createMockSwapSessionStorage());
}
