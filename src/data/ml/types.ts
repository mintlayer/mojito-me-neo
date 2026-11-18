// Normalized shapes for the public Mintlayer indexer responses (/api/v2,
// facts in api-coverage.md and decisions.md F6). Amounts arrive as
// {"atoms": "...", "decimal": "..."} pairs, bare strings, or Uint64 encoded
// as a number or a string; the AmountJson tolerance is the single place that
// absorbs every documented shape. Field names mirror the web-server JSON
// helpers in mintlayer-core so the mapping stays diffable against upstream.

/** Indexer amount as received: one or both of the documented pair. */
export type AmountJson = { atoms?: string; decimal?: string };

/** GET /address/{addr}. A 404 AddressNotFound (fresh address, no history)
 *  is mapped by the client to the zero form, never surfaced as an error. */
export type MlAddressInfo = {
  coinBalance: AmountJson;
  lockedCoinBalance: AmountJson;
  tokens: { tokenId: string; amount: AmountJson }[];
  /** Transaction ids, newest first. */
  transactionHistory: string[];
};

/** Output value as received: coin or token, with the amount pair. */
export type MlOutputValue = {
  type: 'Coin' | 'TokenV0' | 'TokenV1' | (string & {});
  tokenId?: string;
  amount?: AmountJson;
};

/** One tx output or UTXO output. The wallet reads Transfer, LockThenTransfer,
 *  Htlc (value plus destination) and IssueNft (token id) shapes; every other
 *  output type stays readable through the open `type` field. */
export type MlOutput = {
  type: string;
  destination?: string;
  value?: MlOutputValue;
  tokenId?: string;
};

/** Outpoint as received: Transaction or BlockReward source. */
export type MlOutpoint = { sourceType: string; sourceId: string; index: number };

/** Entries of GET /address/{addr}/spendable-utxos and /all-utxos. */
export type MlUtxo = { outpoint: MlOutpoint; output: MlOutput };

/** Transaction input as received (the resolved spent output rides in `utxo`). */
export type MlTransactionInput = { inputType: string; utxo: MlOutput | null };

/** GET /transaction/{id}. A mempool-pending tx has null block fields, no
 *  timestamp and null confirmations (api-server 1.4.1+ shape). */
export type MlTransaction = {
  id: string;
  inputs: MlTransactionInput[];
  outputs: MlOutput[];
  fee: AmountJson | null;
  blockId: string | null;
  /** Unix seconds, null while pending. */
  timestamp: number | null;
  /** Null while pending (the server sends an empty string). */
  confirmations: number | null;
};

/** GET /token/{id}. The wallet consumes ticker and decimals; total supply
 *  and freeze bookkeeping stay upstream until a screen needs them. */
export type MlTokenInfo = {
  authority: string;
  ticker: string | null;
  decimals: number;
  circulatingSupply: AmountJson | null;
  metadataUri: string | null;
  frozen: boolean;
};

/** GET /nft/{id}. Null fields are optional upstream (creator, owner, media). */
export type MlNftInfo = {
  id: string;
  name: string | null;
  ticker: string | null;
  description: string | null;
  creator: string | null;
  owner: string | null;
  mediaUri: string | null;
  iconUri: string | null;
  mediaHash: string | null;
};

/** GET /statistics/coin. */
/** One currency side of an order: the base coin or a token id (F11). */
export type MlOrderCurrency = { type: 'Coin' | 'Token' | (string & {}); tokenId?: string };

/** One entry of GET /order and GET /order/{id} (api-coverage.md). The
 *  balances shrink as takers fill; initially_given/asked anchor the fill
 *  progress; conclude_destination anchors the myOrders membership filter. */
export type MlOrderInfo = {
  orderId: string;
  giveBalance: AmountJson;
  askBalance: AmountJson;
  giveCurrency: MlOrderCurrency;
  askCurrency: MlOrderCurrency;
  initiallyGiven: AmountJson | null;
  initiallyAsked: AmountJson | null;
  concludeDestination: string;
  /** Frozen state field when the indexer serves it (maker freeze). */
  frozen?: boolean;
};

/** One aggregated level of GET /order/pair/{BASE}_{QUOTE}/book. */
export type OrderBookLevel = { price: AmountJson; amount: AmountJson };

/** Order book page (keyset cursor envelope; truncated flags the 10,000 cap). */
export type OrderBookPage = {
  levels: OrderBookLevel[];
  nextCursor: string | null;
  truncated: boolean;
};
