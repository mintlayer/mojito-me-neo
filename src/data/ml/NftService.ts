// NFT holdings (spec M2): the indexer has no reverse address-to-NFT route,
// so ownership comes from the token ids the address summaries already carry
// (IssueNft outputs are indexed into per-address balances, one unit each,
// api-coverage.md finding 2) and each id is probed once against GET /nft/{id}.
// A 404 means the id is a fungible token, not an error. Probes and metadata
// are cached in session memory; probing stays sequential to stay
// rate-limit friendly.
import { IndexerClient, IndexerError } from './IndexerClient';
import type { MlNftInfo } from './types';

export class NftService {
  private readonly client: IndexerClient;

  /** null marks a probed non-NFT id, so fungible ids are never re-probed. */
  private readonly known = new Map<string, MlNftInfo | null>();

  constructor(client: IndexerClient) {
    this.client = client;
  }

  /** The subset of the given token ids that are NFTs. */
  async identify(tokenIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const tokenId of tokenIds) {
      const info = await this.metadata(tokenId);
      if (info) out.add(tokenId);
    }
    return out;
  }

  /** Issuance metadata for one id; null when the id is not an NFT. */
  async metadata(tokenId: string): Promise<MlNftInfo | null> {
    if (this.known.has(tokenId)) return this.known.get(tokenId) ?? null;
    let info: MlNftInfo | null;
    try {
      info = await this.client.nft(tokenId);
    } catch (e) {
      // Anything but the documented non-NFT 404 is a real failure; the
      // metadata-missing UI state covers transient misses on later refreshes.
      if (e instanceof IndexerError && e.kind === 'http' && e.status === 404) {
        info = null;
      } else {
        throw e;
      }
    }
    this.known.set(tokenId, info);
    return info;
  }
}
