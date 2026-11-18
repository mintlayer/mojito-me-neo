// Waitlist provider selection and the gap 4 HTTP contract, unit-tested with
// a stub transport so flipping to the real backend stays config-only:
//   npx tsx src/data/providers/WaitlistProvider.test.ts
import { strict as assert } from 'node:assert/strict';

import { createHttpWaitlistProvider, createWaitlistProvider } from './WaitlistProvider';
import type { FetchLike } from '../transport';

type RecordedCall = { url: string; method?: string; body?: string };

function stubFetch(answer: { status: number; body: string }, calls: RecordedCall[]): FetchLike {
  return async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: { get: () => 'application/json' },
      text: async () => answer.body,
    };
  };
}

async function main() {
  // 201 { position } is the fresh join.
  const calls: RecordedCall[] = [];
  const provider = createHttpWaitlistProvider({ base: 'https://waitlist.example.org', fetch: stubFetch({ status: 201, body: '{"position":12848}' }, calls) });
  const joined = await provider.join('User@Example.COM');
  assert.deepEqual(joined, { ok: true, position: 12848 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://waitlist.example.org/v1/waitlist');
  assert.equal(calls[0].method, 'POST');
  const sent = JSON.parse(calls[0].body ?? '{}') as { email: string; client: string; createdAt: string };
  assert.equal(sent.email, 'user@example.com', 'the request carries the trimmed lowercase address');
  assert.equal(sent.client, 'mojito-mobile');
  assert.ok(!Number.isNaN(Date.parse(sent.createdAt)), 'createdAt is an ISO timestamp');

  // 200 { duplicate } is the idempotent success: already on the list.
  const duplicate = await createHttpWaitlistProvider({ base: 'https://waitlist.example.org', fetch: stubFetch({ status: 200, body: '{"duplicate":true,"position":812}' }, []) }).join('user@example.com');
  assert.deepEqual(duplicate, { ok: true, position: 812 });

  // 400 invalid_email, 503 unavailable, everything else unavailable; a
  // transport failure and a non-JSON body land in unavailable too.
  const bad = await createHttpWaitlistProvider({ base: 'https://waitlist.example.org', fetch: stubFetch({ status: 400, body: '{"error":"invalid_email"}' }, []) }).join('nope');
  assert.deepEqual(bad, { ok: false, reason: 'invalid' });
  const down = await createHttpWaitlistProvider({ base: 'https://waitlist.example.org', fetch: stubFetch({ status: 503, body: '{"error":"unavailable"}' }, []) }).join('user@example.com');
  assert.deepEqual(down, { ok: false, reason: 'unavailable' });
  const walled = await createHttpWaitlistProvider({ base: 'https://waitlist.example.org', fetch: stubFetch({ status: 500, body: 'oops' }, []) }).join('user@example.com');
  assert.deepEqual(walled, { ok: false, reason: 'unavailable' });
  const dead = await createHttpWaitlistProvider({
    base: 'https://waitlist.example.org',
    fetch: async () => {
      throw new Error('airplane mode');
    },
  }).join('user@example.com');
  assert.deepEqual(dead, { ok: false, reason: 'unavailable' });
  const gibberish = await createHttpWaitlistProvider({ base: 'https://waitlist.example.org', fetch: stubFetch({ status: 201, body: '<html>' }, []) }).join('user@example.com');
  assert.deepEqual(gibberish, { ok: false, reason: 'unavailable' });

  // Contract note: gap 4 has no member-status or removal route yet, so the
  // HTTP provider refuses status typed and leave stays a local no-op.
  const bare = createHttpWaitlistProvider({ base: 'https://waitlist.example.org', fetch: stubFetch({ status: 200, body: '{}' }, []) });
  await assert.rejects(() => bare.status(), /member-status route/);
  await bare.leave();

  // Factory selection: no base means the local store, a base means HTTP
  // (distinguished by the typed member-status refusal that only the HTTP
  // provider answers with; the local store reports joined state).
  const local = createWaitlistProvider({ waitlistBase: null });
  const fresh = await local.join('factory.local@example.com');
  assert.equal(fresh.ok, true);
  assert.equal((await local.status()).joined, true);
  await local.leave();
  assert.equal((await local.status()).joined, false);

  const selected = createWaitlistProvider({ waitlistBase: 'https://waitlist.example.org' });
  await assert.rejects(() => selected.status(), /member-status route/, 'a configured base selects the HTTP provider');

  console.log('waitlist providers: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
