// Onboarding fixtures, ported from the design's onb-data.jsx.
// Everything here is demo data: the phrase is fixed, the addresses are
// synthetic and unfunded, and the checksum rule below is a stand-in.

// The design ships a truncated BIP39 list (a -> cy). Enough for the import
// autocomplete demo; swap in the full 2048-word list for real use.
export const BIP39 =
  'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert alien all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor army around arrange arrest arrive arrow art artist artwork ask aspect assault asset assist assume asthma athlete atom attack attend attitude attract auction audit august aunt author auto autumn average avocado avoid awake aware away awesome awful awkward axis baby bachelor bacon badge bag balance balcony ball bamboo banana banner bar barely bargain barrel base basic basket battle beach bean beauty because become beef before begin behave behind believe below belt bench benefit best betray better between beyond bicycle bid bike bind biology bird birth bitter black blade blame blanket blast bleak bless blind blood blossom blouse blue blur blush board boat body boil bomb bone bonus book boost border boring borrow boss bottom bounce box boy bracket brain brand brass brave bread breeze brick bridge brief bright bring brisk broken bronze broom brother brown brush bubble buddy budget buffalo build bulb bulk bullet bundle bunker burden burger burst bus business busy butter buyer buzz cabbage cabin cable cactus cage cake call calm camera camp canal cancel candy cannon canoe canvas canyon capable capital captain car carbon card cargo carpet carry cart case cash casino castle casual cat catalog catch category cattle caught cause caution cave ceiling celery cement census century cereal certain chair chalk champion change chaos chapter charge chase chat cheap check cheese chef cherry chest chicken chief child chimney choice choose chronic chuckle chunk churn cigar cinnamon circle citizen city civil claim clap clarify claw clay clean clerk clever click client cliff climb clinic clip clock clog close cloth cloud clown club clump cluster clutch coach coast coconut code coffee coil coin collect color column combine come comfort comic common company concert conduct confirm congress connect consider control convince cook cool copper copy coral core corn correct cost cotton couch country couple course cousin cover coyote crack cradle craft cram crane crash crater crawl crazy cream credit creek crew cricket crime crisp critic crop cross crouch crowd crucial cruel cruise crumble crunch crush cry crystal cube culture cup cupboard curious current curtain curve cushion custom cute cycle'.split(
    ' ',
  );

/** The 24-word phrase shown on the create path (all real BIP39 words). */
export const SEED = [
  'ancient', 'bridge', 'canyon', 'anchor', 'coconut', 'circle', 'credit', 'crystal',
  'autumn', 'balance', 'beach', 'bench', 'camera', 'castle', 'ceiling', 'century',
  'cherry', 'clever', 'cliff', 'cluster', 'coral', 'cotton', 'crane', 'brave',
];

// Stand-in for BIP39 checksum verification: a phrase "checks out" when it is
// complete, every word is in the list, and the last word is one of these.
// ponytail: a real checksum needs the full 2048 list + SHA-256 over the
// entropy; swap in bip39.validateMnemonic when this stops being a mock.
const CHECK_WORDS = new Set(['brave', 'coin', 'claim', 'beach', 'army', 'atom', 'bonus', 'circle']);

export const checksumOK = (words) =>
  words.length > 0 && words.every((w) => BIP39.includes(w)) && CHECK_WORDS.has(words[words.length - 1]);

export const DEMO_PHRASES = {
  valid12: 'autumn balance camera castle cherry clever cliff coral cotton crane crystal coin',
  valid24: SEED.join(' '),
  badsum24: SEED.slice(0, 23).join(' ') + ' bridge', // duplicate word: fails the mock checksum
};

export const ACCOUNTS = [
  { name: 'Account 1', path: "m/84'/0'/0'", btc: '0.03420000', ml: '1,250.00', usd: '$2,103.18' },
  { name: 'Account 2', path: "m/84'/0'/1'", btc: '0.00180000', ml: '86.40', usd: '$112.55' },
  { name: 'Account 3', path: "m/84'/0'/2'", btc: '0.00000000', ml: '12.50', usd: '$1.06' },
];

/** Word counts a pasted phrase is allowed to collapse to. */
export const PHRASE_LENGTHS = [12, 15, 18, 21, 24];
