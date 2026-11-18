// Order book service gate (spec M4 testing section): cursor-paginated depth
// aggregation, the num/denom price rational, the invalid-cursor page-1
// restart and the honest null last-fill. Offline over a scripted reader.
//   tsx src/trade/orderBookService.test.ts
import { strict as assert } from 'node:assert/strict';

import { IndexerError } from '../data/ml/IndexerClient';
import type { OrderBookLevel, OrderBookPage } from '../data/ml/types';
import { bookPriceDecimal, createOrderBookService, DEFAULT_BOOK_DEPTH } from './OrderBookService';

type ReaderScript = ({ page: OrderBookPage } | { fail: number })[];

function scriptedReader(script: ReaderScript, calls: (string | null)[] = []): { orderBook(base: string, quote: string, side: 'ask' | 'bid', cursor?: string): Promise<OrderBookPage> } {
  let index = 0;
  return {
    async orderBook(_base, _quote, _side, cursor) {
      calls.push(cursor ?? null);
      if (index >= script.length) throw new IndexerError('transport', 'book', undefined);
      const step = script[index++];
      if ('fail' in step) throw new IndexerError('http', 'book', step.fail);
      return step.page;
    },
  };
}

const level = (price: OrderBookLevel['price'], atoms: string): OrderBookLevel => ({ price, amount: { atoms } });

async function main() {
  // Depth aggregation: pages follow the cursor until depth rows exist.
  const calls: (string | null)[] = [];
  const service = createOrderBookService({
    reader: scriptedReader(
      [
        { page: { levels: [level({ decimal: '0.3458' }, '1248000000000'), level({ decimal: '0.3452' }, '842000000000')], nextCursor: 'c1', truncated: false } },
        { page: { levels: [level({ atoms: '69/200' }, '3214000000000')], nextCursor: null, truncated: false } },
      ],
      calls,
    ),
  });
  const asks = await service.levels('ML', 'USDT', 'ask');
  assert.equal(asks.length, 3);
  assert.equal(asks[0].price, '0.3458');
  assert.equal(asks[0].size, '12.48');
  assert.equal(calls[0], null);
  assert.equal(calls[1], 'c1');

  // num/denom rational flattens at display precision (69/200 = 0.345).
  assert.equal(asks[2].price, '0.345');
  assert.equal(bookPriceDecimal({ atoms: '1/8' }), '0.125');
  assert.throws(() => bookPriceDecimal({ atoms: '5/0' }), /parse/);
  assert.throws(() => bookPriceDecimal({ atoms: 'zzz' }), /parse/);

  // Depth cap: fewer rows than the walk found.
  const capped = await createOrderBookService({
    reader: scriptedReader([
      { page: { levels: [level({ decimal: '0.3458' }, '1248000000000'), level({ decimal: '0.3452' }, '842000000000')], nextCursor: 'c1', truncated: false } },
      { page: { levels: [level({ decimal: '0.345' }, '3214000000000')], nextCursor: null, truncated: false } },
    ]),
  }).levels('ML', 'USDT', 'bid', 2);
  assert.equal(capped.length, 2);
  assert.equal(DEFAULT_BOOK_DEPTH, 6);

  // last(): no trusted trades source in v1, always null.
  assert.equal(await service.last(), null);

  // Invalid cursor: a 400 on a cursor page restarts once from page 1 and
  // rebuilds the rows so no stale generation survives.
  const restartCalls: (string | null)[] = [];
  const restartService = createOrderBookService({
    reader: scriptedReader(
      [
        { page: { levels: [level({ decimal: '0.35' }, '100000000000')], nextCursor: 'stale', truncated: false } },
        { fail: 400 },
        { page: { levels: [level({ decimal: '0.36' }, '200000000000')], nextCursor: null, truncated: false } },
      ],
      restartCalls,
    ),
  });
  const recovered = await restartService.levels('ML', 'USDT', 'ask');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].price, '0.36');
  assert.deepEqual(restartCalls, [null, 'stale', null]);

  // A second invalid cursor (restart exhausted) surfaces the typed error
  // instead of looping.
  const exhausted = createOrderBookService({
    reader: scriptedReader([
      { page: { levels: [level({ decimal: '0.35' }, '100000000000')], nextCursor: 'stale', truncated: false } },
      { fail: 400 },
      { fail: 400 },
    ]),
  });
  await assert.rejects(() => exhausted.levels('ML', 'USDT', 'ask'), (e: unknown) => e instanceof IndexerError && e.status === 400);

  // Transport failures surface typed: the screen renders the error state,
  // never fabricated rows.
  const down = createOrderBookService({ reader: scriptedReader([{ fail: 500 }]) });
  await assert.rejects(() => down.levels('ML', 'USDT', 'ask'), (e: unknown) => e instanceof IndexerError);

  console.log('orderBookService: ok');
}

main();
