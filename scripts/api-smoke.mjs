// Contract smoke against the mainnet Mintlayer indexer (read-only). Runs
// manually or in the nightly job; deliberately NOT part of npm run check
// (the pre-commit gate stays offline, per the M2 spec testing section).
//   node scripts/api-smoke.mjs
//   MOJITO_INDEXER_BASE=http://127.0.0.1:3000/api/v2 node scripts/api-smoke.mjs
const base = (process.env.MOJITO_INDEXER_BASE ?? 'https://api-server.mintlayer.org/api/v2').replace(/\/+$/, '');

// Public derivation test vector (project decision log F5, mainnet). A 404
// AddressNotFound is a VALID answer here: it proves the endpoint contract
// for an unused address without depending on any particular funded account.
const VECTOR_ADDRESS = 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl';

let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function getJson(path) {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function main() {
  // 1. Chain tip: block_height (number or string) plus a 64-char block id.
  try {
    const { status, body } = await getJson('/chain/tip');
    const height = Number(body?.block_height);
    const blockId = typeof body?.block_id === 'string' ? body.block_id : '';
    check('GET /chain/tip', status === 200 && Number.isFinite(height) && blockId.length === 64, `height ${body?.block_height}`);
  } catch (e) {
    check('GET /chain/tip', false, String(e));
  }

  // 2. Address info for the test-vector address: 200 with the documented
  // shape, or the documented 404 AddressNotFound for an unused address.
  try {
    const { status, body } = await getJson(`/address/${VECTOR_ADDRESS}`);
    const ok =
      (status === 200 && body && typeof body === 'object' && 'coin_balance' in body && Array.isArray(body.tokens) && Array.isArray(body.transaction_history)) ||
      (status === 404 && body && typeof body === 'object' && 'error' in body);
    check(`GET /address/${VECTOR_ADDRESS}`, ok, `http ${status}`);
  } catch (e) {
    check(`GET /address/${VECTOR_ADDRESS}`, false, String(e));
  }

  // 3. Feerate: a bare JSON string of atoms per kB (cached server-side 30s).
  try {
    const { status, body } = await getJson('/feerate');
    check('GET /feerate', status === 200 && typeof body === 'string' && /^\d+$/.test(body), `${body} atoms/kB`);
  } catch (e) {
    check('GET /feerate', false, String(e));
  }

  if (failures > 0) {
    console.error(`api-smoke: ${failures} failure(s) against ${base}`);
    process.exit(1);
  }
  console.log(`api-smoke: all checks passed against ${base}`);
}

main();
