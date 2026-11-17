// Discovery seam: probing derived addresses for funds. M1 ships a fixture
// implementation so the found and none branches both stay reachable without
// a network; M2 replaces it behind the same interface with the indexer
// client (addresses/summary over the public Mintlayer API and the btc-api
// Esplora-style routes).
export interface AddressProbe {
  /** Which of the given addresses have on-chain history. */
  probe(addresses: string[]): Promise<{ funded: string[] }>;
}

/**
 * Fixture probe: a static funded list. It pins the public parity testnet
 * address, so importing the published test mnemonic demonstrates the found
 * branch while every freshly generated wallet lands on none.
 */
export function createFixtureAddressProbe(): AddressProbe {
  const funded = new Set<string>([
    'tmt1qyxqfq37rra32sq6zhayqcpjwh4trc07mcfardwt',
    'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl',
  ]);
  return {
    async probe(addresses: string[]) {
      return { funded: addresses.filter((a) => funded.has(a)) };
    },
  };
}
