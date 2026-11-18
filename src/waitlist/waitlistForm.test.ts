// WaitlistForm machine: validation matrix and phase transitions:
//   npx tsx src/waitlist/waitlistForm.test.ts
import { strict as assert } from 'node:assert/strict';

import { checkEmail, maskEmail, normalizeEmail, WaitlistForm } from './WaitlistForm';
import type { WaitlistMemberStatus, WaitlistProvider, WaitlistResult } from '../data/providers/types';

/** Scriptable provider double: join answers from a script (an entry of
 *  'throw' rejects), status answers from a fixture; every call is counted. */
function stubProvider(script: {
  join: (WaitlistResult | 'throw')[];
  status?: WaitlistMemberStatus | 'reject';
}) {
  const joinCalls: string[] = [];
  let statusCalls = 0;
  const provider: WaitlistProvider = {
    async join(email) {
      joinCalls.push(email);
      const answer = script.join[joinCalls.length - 1];
      if (!answer) throw new Error('join script exhausted');
      if (answer === 'throw') throw new Error('transport down');
      return answer;
    },
    async status() {
      statusCalls += 1;
      if (script.status === 'reject') throw new Error('no member-status route');
      return script.status ?? { joined: false, email: null, position: null };
    },
    async leave() {
      return;
    },
  };
  return { provider, joinCalls, statusCalls: () => statusCalls };
}

async function main() {
  // Validation matrix (spec M5): valid, double at, empty, overlength,
  // unicode local part accepted but lowercased.
  assert.equal(checkEmail('User@Example.com'), 'ok');
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(checkEmail('a@b@c'), 'invalid', 'double at is refused');
  assert.equal(checkEmail(''), 'invalid');
  assert.equal(checkEmail('   '), 'invalid');
  assert.equal(checkEmail('no-at-sign'), 'invalid');
  assert.equal(checkEmail('@domain.example'), 'invalid', 'an empty local part is refused');
  assert.equal(checkEmail('user@'), 'invalid', 'an empty domain is refused');
  assert.equal(checkEmail(`${'a'.repeat(64)}@${'b'.repeat(191)}`), 'invalid', 'over RFC 5321 length is refused');
  assert.equal(checkEmail(`${'a'.repeat(64)}@${'b'.repeat(185)}.com`), 'ok', 'exactly 254 total is accepted');
  assert.equal(checkEmail(`${'a'.repeat(65)}@example.com`), 'invalid', 'over the local-part cap is refused');
  assert.equal(checkEmail('J\u00fcrgen@Example.COM'), 'ok', 'a unicode local part is accepted');
  assert.equal(normalizeEmail('J\u00fcrgen@Example.COM'), 'j\u00fcrgen@example.com', 'and lowercased');
  assert.equal(checkEmail('a<b@c.d'), 'invalid', 'markup delimiters are refused');
  assert.equal(checkEmail('a b@c.d'), 'invalid', 'whitespace is refused');
  assert.equal(checkEmail('a\tb@c.d'), 'invalid', 'control characters are refused');

  // Redaction: mask the local part, show the domain.
  assert.equal(maskEmail('john.doe@example.com'), 'j***@example.com');
  assert.equal(maskEmail('a@b.co'), 'a***@b.co');
  assert.equal(maskEmail('@nodomain'), '***');

  // idle -> submitting -> done with the normalized address sent.
  const happy = stubProvider({ join: [{ ok: true, position: 12848 }, { ok: true, position: null }] });
  const form = new WaitlistForm(happy.provider);
  assert.equal(form.currentPhase, 'idle');
  assert.equal(form.validate(), 'invalid');
  form.setEmail('  User@Example.COM ');
  assert.equal(form.validate(), 'ok');
  assert.equal(form.email, 'user@example.com');
  assert.equal(await form.submit(), 'done');
  assert.deepEqual(happy.joinCalls, ['user@example.com']);
  assert.equal(form.joinedPosition, 12848);

  // Idempotent rejoin: the same address again answers ok with no new
  // position, and the confirmation falls back to the no-position copy.
  form.setEmail('user@example.com');
  assert.equal(form.currentPhase, 'idle', 'editing clears the done phase');
  assert.equal(await form.submit(), 'done');
  assert.equal(form.joinedPosition, null, 'an idempotent rejoin carries the graceful no-position answer');

  // Duplicate: the machine surfaces the address already on file.
  const dup = stubProvider({
    join: [{ ok: false, reason: 'duplicate' }],
    status: { joined: true, email: 'stored@example.com', position: 12849 },
  });
  const dupForm = new WaitlistForm(dup.provider);
  dupForm.setEmail('other@example.com');
  assert.equal(await dupForm.submit(), 'duplicate');
  assert.equal(dupForm.duplicateEmail, 'stored@example.com');
  assert.equal(maskEmail(dupForm.duplicateEmail ?? ''), 's***@example.com');

  // Unavailable: a 503 answer parks the machine with the draft kept;
  // retry re-runs the join and resolves on the scripted second answer.
  const down = stubProvider({
    join: [{ ok: false, reason: 'unavailable' }, { ok: true, position: 12850 }],
    status: 'reject',
  });
  const downForm = new WaitlistForm(down.provider);
  downForm.setEmail('offline@example.com');
  assert.equal(await downForm.submit(), 'unavailable');
  assert.equal(downForm.email, 'offline@example.com', 'the email stays in the field');
  assert.equal(await downForm.retry(), 'done');
  assert.equal(down.joinCalls.length, 2, 'retry re-ran the join once');

  // A provider throw (transport down) lands in unavailable too.
  const flaky = stubProvider({ join: ['throw', { ok: true, position: null }] });
  const flakyForm = new WaitlistForm(flaky.provider);
  flakyForm.setEmail('flaky@example.com');
  assert.equal(await flakyForm.submit(), 'unavailable');
  assert.equal(await flakyForm.retry(), 'done');
  assert.equal(flaky.joinCalls.length, 2);

  // Retry outside unavailable is a no-op that never re-submits.
  const settled = stubProvider({ join: [{ ok: true, position: 1 }] });
  const settledForm = new WaitlistForm(settled.provider);
  settledForm.setEmail('done@example.com');
  assert.equal(await settledForm.submit(), 'done');
  assert.equal(await settledForm.retry(), 'done');
  assert.equal(settled.joinCalls.length, 1);

  // Invalid input never reaches the provider; editing after a failure
  // clears the phase.
  const strict = stubProvider({ join: [] });
  const strictForm = new WaitlistForm(strict.provider);
  strictForm.setEmail('not-an-email');
  assert.equal(await strictForm.submit(), 'invalid');
  assert.deepEqual(strict.joinCalls, [], 'no provider call for malformed input');
  strictForm.setEmail('fixed@example.com');
  assert.equal(strictForm.currentPhase, 'idle');

  // No double submits: a second call while one is in flight returns
  // submitting and the provider sees exactly one join.
  const release = { resolveJoin: () => undefined as void };
  const slowJoinCalls: string[] = [];
  const slowProvider: WaitlistProvider = {
    join: (email) =>
      new Promise<WaitlistResult>((resolve) => {
        release.resolveJoin = () => resolve({ ok: true, position: 1 });
        slowJoinCalls.push(email);
      }),
    status: async () => ({ joined: false, email: null, position: null }),
    leave: async () => undefined,
  };
  const slowForm = new WaitlistForm(slowProvider);
  slowForm.setEmail('slow@example.com');
  const first = slowForm.submit();
  assert.equal(await slowForm.submit(), 'submitting', 'the concurrent submit is refused as still-in-flight');
  release.resolveJoin();
  assert.equal(await first, 'done');
  assert.deepEqual(slowJoinCalls, ['slow@example.com']);
  assert.equal(slowForm.joinedPosition, 1);

  // Submit-during-edit race: the outgoing address is frozen at submit time,
  // so retyping while the join is in flight cannot rename the confirmation
  // copy (the screen renders submittedEmail, not the live draft).
  const releaseRace: { resolveJoin: () => void } = { resolveJoin: () => undefined as void };
  const raceCalls: string[] = [];
  const raceProvider: WaitlistProvider = {
    join: (email) =>
      new Promise<WaitlistResult>((resolve) => {
        releaseRace.resolveJoin = () => resolve({ ok: true, position: 9 });
        raceCalls.push(email);
      }),
    status: async () => ({ joined: false, email: null, position: null }),
    leave: async () => undefined,
  };
  const raceForm = new WaitlistForm(raceProvider);
  raceForm.setEmail('first@example.com');
  const flight = raceForm.submit();
  raceForm.setEmail('second@example.com');
  assert.equal(raceForm.currentPhase, 'submitting', 'the flight keeps the phase while the draft edits');
  releaseRace.resolveJoin();
  assert.equal(await flight, 'done');
  assert.deepEqual(raceCalls, ['first@example.com']);
  assert.equal(raceForm.submittedEmail, 'first@example.com', 'the confirmation names the sent address, not the edited draft');
  assert.equal(raceForm.email, 'second@example.com', 'the draft itself still holds the edit');

  console.log('waitlist form: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
