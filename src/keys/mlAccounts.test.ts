// Mintlayer derivation parity gate: the TS path must reproduce the vendored
// wallet-bindings v0.1.0 outputs byte for byte. The constants are the
// upstream release vectors (rust-sdk bindings/tests/parity.rs, decisions F5).
//   tsx src/keys/mlAccounts.test.ts
import { strict as assert } from 'node:assert/strict';

import { deriveMlAccount, mlAddressAt, mlAddressPublicKey } from './mlAccounts';
import { deriveCustomScan } from './customPath';

const MNEMONIC = `${Array(23).fill('abandon').join(' ')} art`;

const PARITY = {
  // account blob formats, from the upstream parity test
  xpriv: {
    testnet:
      '00038000002c800000018000000012ed17c3e72223beb38ea98ec1317581f02458f02b0ecf4abe02c6490eca170a900d967bc0c84b9c2da3b55f7db9f76cbdc0469176a76d01141af2a705b4353a',
    mainnet:
      '00038000002c80004d4c800000005280d67624d70241021ee99da728121cb69e2356e7776cbc360fc25dedc35d8c3ee4db2b274aa3fac7024333d45f916ac113cd63c47e9444d39d46827dce1a24',
  },
  xpub: {
    testnet:
      '00038000002c800000018000000012ed17c3e72223beb38ea98ec1317581f02458f02b0ecf4abe02c6490eca170a03b9385a6fbee0caa6e79407f83b0053e2d864b6c7a8f32ce61c3f495b5dd5d027',
    mainnet:
      '00038000002c80004d4c800000005280d67624d70241021ee99da728121cb69e2356e7776cbc360fc25dedc35d8c026c3ac93c48d49fa446a13c846b1ef04255e1526018ea445949078d96947e7454',
  },
  // receiving public key blob at index 0
  receivingBlob: {
    testnet: '00035a6f28253f35e2ff1ab0b086b8c87f731159661157e5be2ca98188369625dc32',
    mainnet: '00030db84115b4aa824edfefeb4998d3e5e9131188719cb960540010e20f29777a05',
  },
  // bech32m pubkeyhash address of receiving key 0
  address: {
    testnet: 'tmt1qyxqfq37rra32sq6zhayqcpjwh4trc07mcfardwt',
    mainnet: 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl',
  },
} as const;

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

async function main() {
  const words = MNEMONIC.split(' ');

  for (const network of ['testnet', 'mainnet'] as const) {
    const account = await deriveMlAccount(words, network);
    assert.equal(account.coinType, network === 'mainnet' ? 19788 : 1);
    assert.equal(
      bytesToHex(account.accountPrivkey),
      PARITY.xpriv[network],
      `${network}: account privkey blob must match the bindings parity vector`,
    );
    assert.equal(
      bytesToHex(account.xpub),
      PARITY.xpub[network],
      `${network}: account xpub blob must match the bindings parity vector`,
    );

    const blob = await mlAddressPublicKey(account.xpub, 0, 0);
    assert.equal(
      bytesToHex(blob),
      PARITY.receivingBlob[network],
      `${network}: receiving key 0 blob must match the bindings parity vector`,
    );

    const address = await mlAddressAt(account.xpub, 0, 0, network);
    assert.equal(address, PARITY.address[network], `${network}: parity address mismatch`);

    // Deterministic: the same phrase derives the same addresses again.
    const again = await deriveMlAccount(words, network);
    assert.equal(await mlAddressAt(again.xpub, 0, 0, network), address);

    // Branch separation: change key 0 differs from receiving key 0.
    const change = await mlAddressAt(account.xpub, 1, 0, network);
    assert.notEqual(change, address);
  }

  // A passphrase changes every derived blob.
  const passed = await deriveMlAccount(words, 'testnet', 'secret');
  assert.notEqual(bytesToHex(passed.accountPrivkey), bytesToHex(await deriveMlAccount(words, 'testnet').then((a) => a.accountPrivkey)));

  // Testnet addresses start tmt1, mainnet mtc1 (F5).
  const tn = await deriveMlAccount(words, 'testnet');
  const first = await mlAddressAt(tn.xpub, 0, 0, 'testnet');
  assert.ok(first.startsWith('tmt1'), 'testnet address prefix');

  // The custom-path scan reuses the same derivation: the canonical testnet
  // account path reproduces the parity xpub blob above, and a different
  // account index differs from it.
  const scanned = await deriveCustomScan(words, "m/44'/1'/0'");
  assert.equal(scanned.chain, 'ml');
  assert.equal(
    bytesToHex((scanned.account as import('./mlAccounts').MlAccount).xpub),
    PARITY.xpub.testnet,
    'custom scan of the canonical path must match the parity vector',
  );
  const other = await deriveCustomScan(words, "m/44'/1'/2'");
  assert.notEqual(
    bytesToHex((other.account as import('./mlAccounts').MlAccount).xpub),
    PARITY.xpub.testnet,
  );

  console.log('mlAccounts.test.ts: all parity vectors match');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
