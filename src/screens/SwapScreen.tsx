import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient as SvgGrad, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { hex as hexOf } from '@scure/base';
import { t, type I18nKey } from '../i18n';
import { useProviders } from '../data/providers/context';
import { fnv1a } from '../data/mock/hash';
import { MojitoCore } from '../../modules/mojito-core';
import { isBindingsUnavailable } from '../send/errors';
import { assertTransition, type SwapSessionRow, type SwapState } from '../trade/swapSession';
import type { StepState } from '../ui/StepState';
import { C, G } from '../theme';
import { AmountRow, Btn, Callout, Card, FlowX, Label, PctButtons, Screen, ScreenIntro, Segmented, Steps, Txt } from '../ui';

const ML_DECIMALS = 11;
const TIMELOCK_CHOICES = ['12h', '24h', '48h'] as const;
type TimelockChoice = (typeof TIMELOCK_CHOICES)[number];
const TIMELOCK_SECONDS: Record<TimelockChoice, number> = { '12h': 43_200, '24h': 86_400, '48h': 172_800 };
/** Demo counterparty spend path (MOCK MODE ONLY): the offer exchange is
 *  off-band and the BTC side is the scripted counterpart. Real mode never
 *  reaches this constant: initiate is gated with a typed unsupported until
 *  a real offer entry supplies the counterparty spend address and key
 *  (see swapGateError and plans/mojito-neo/decisions.md). */
const COUNTERPARTY_ADDRESS = 'mtc1q82twmwwxa3l2pe26gf0zgghu69jtez3qq2ajqyl';

/** Real-mode initiate gate in the BridgeError shape (typed unsupported,
 *  mirrored from BridgeProvider.initiate): a real lock must name the
 *  counterparty spend path from an explicit offer, and no offer entry
 *  exists yet. Nothing may lock to the demo vector in real mode. */
class SwapGateError extends Error {
  readonly failure = 'unsupported' as const;
}

export function SwapScreen() {
  const assets = useDataCompat();
  const { htlc, swapSessions, data, mode } = useProviders();
  const [amount, setAmount] = useState('0.025');
  const [timelock, setTimelock] = useState<TimelockChoice>('48h');
  const [sessions, setSessions] = useState<SwapSessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The preimage lives only in this closure (spec security note): it never
   *  persists and never logs; losing it forfeits the swap, which the
   *  keep-open warning discloses. */
  const preimageRef = useRef<Uint8Array | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await swapSessions.all());
    } catch {
      setSessions([]);
    }
  }, [swapSessions]);
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  /** Lock Mintlayer in two steps: initiate builds and signs (no
   *  broadcast), the session row persists the lock tx bytes at state
   *  'offered', then broadcastLock sends the prepared transaction and the
   *  row transitions offered -> locked. The bytes-at-rest-before-broadcast
   *  order is the point: a crash after the broadcast still leaves the
   *  refund leg's decode input. The refund path is a wallet-owned address
   *  and the spend path is the demo vector in mock mode; real mode refuses
   *  typed. */
  const initiate = async () => {
    setError(null);
    if (mode === 'real') {
      setError(swapErrorCopy(new SwapGateError('real-mode locking needs a counterparty offer; offer entry is pending')));
      return;
    }
    const mlSeconds = TIMELOCK_SECONDS[timelock];
    setBusy(true);
    try {
      // Refund address: the wallet's own allocation, so the wallet can
      // sign the refund after expiry (a foreign address would lock the
      // refund to a key this wallet cannot spend).
      const refundAddress = (await data.getAddresses()).Mintlayer;
      if (!refundAddress) throw new SwapGateError('no wallet mintlayer address to refund to');
      const secret = await swapSecret(mode);
      const secretHash = sha256(secret);
      preimageRef.current = secret;
      const prepared = await htlc.initiate(
        {
          role: 'initiator',
          giveChain: 'ml',
          giveAtoms: toAtoms(amount),
          wantAtoms: wantAtomsOf(amount),
          secretHash,
          timelockSeconds: mlSeconds,
        },
        { address: COUNTERPARTY_ADDRESS },
        refundAddress,
      );
      const row: SwapSessionRow = {
        id: prepared.txId,
        offer: { role: 'initiator', giveChain: 'ml', giveAtoms: toAtoms(amount), wantAtoms: wantAtomsOf(amount), secretHash, timelockSeconds: mlSeconds },
        secretHashHex: bytesToHex(secretHash),
        spendAddress: COUNTERPARTY_ADDRESS,
        refundAddress,
        lockTxHex: bytesToHex(prepared.lockTx),
        state: 'offered',
        txIds: [],
        updatedAt: Date.now(),
      };
      // Bytes at rest BEFORE the broadcast: the row (with the lock tx
      // bytes) is stored first, so the honest refund source survives a
      // crash that happens after the broadcast.
      await swapSessions.save(row);
      const { txId } = await htlc.broadcastLock(prepared);
      assertTransition(row.state, 'locked');
      try {
        await swapSessions.save({ ...row, state: 'locked', txIds: [txId], updatedAt: Date.now() });
      } catch {
        // The lock IS on-chain: the generic nothing-sent copy would invite
        // a second lock. Name the tx id; the offered row keeps the bytes,
        // so the refund path stays available.
        setError(t('swap.error.lockedRecord', { txId: prepared.txId }));
        void loadSessions();
        return;
      }
      void loadSessions();
    } catch (e) {
      setError(swapErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  const refund = async (session: SwapSessionRow) => {
    setError(null);
    setBusy(true);
    try {
      // The refund rebuilds the lock parameters from the locally captured
      // unsigned lock transaction bytes (the decode seam consumes bytes,
      // not the tx id); rows without them cannot refund honestly. An
      // 'offered' row whose post-broadcast save failed refunds from the
      // same bytes, hence offered -> refunded in the machine.
      if (!session.lockTxHex) throw new SwapGateError('stored session predates the lock tx bytes record');
      assertTransition(session.state, 'refunded');
      const { txId } = await htlc.refund(hexOf.decode(session.lockTxHex));
      await swapSessions.save({ ...session, state: 'refunded', txIds: [...session.txIds, txId].slice(0, 16), updatedAt: Date.now() });
      void loadSessions();
    } catch (e) {
      setError(swapErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  const active = sessions?.find((s) => s.state === 'offered' || s.state === 'locked' || s.state === 'claiming') ?? null;
  const mlPrice = 'ML' in assets.priceMap ? assets.priceMap.ML : 0;
  const rate = rateOf(amount, assets.priceMap);

  return (
    <Screen>
      <ScreenIntro title={t('swap.title')} chip={t('swap.chip')} tone={C.amber} blurb={t('swap.blurb')} />

      {mode === 'mock' && (
        <View className="px-5 pt-4">
          <Callout tone={C.amber} icon="shield">{t('swap.demo.note')}</Callout>
        </View>
      )}
      {mode === 'real' && (
        <View className="px-5 pt-4">
          <Callout tone={C.amber} icon="shield">{t('swap.real.unavailable')}</Callout>
        </View>
      )}
      {active && (
        <View className="px-5 pt-4">
          <Callout tone={C.amber} icon="lock">{t('swap.warn.keepOpen')}</Callout>
        </View>
      )}
      {error && (
        <View className="px-5 pt-4">
          <Callout tone={C.red} icon="shield" accessibilityRole="alert">{error}</Callout>
        </View>
      )}

      {/* Lock leg entry */}
      <View className="px-5 pt-5">
        <Card className="p-[18px]">
          <View className="flex-row justify-between items-center">
            <Label>{t('swap.step.lock')}</Label>
            <Txt mono className="text-[11px] text-text2">
              {`${t('swap.offer.rate')} ${rate}`}
            </Txt>
          </View>
          <View className="mt-3">
            <AmountRow symbol="ML" chain="Mintlayer" value={amount} onChangeText={setAmount} accessibilityLabel={t('swap.step.lock')} />
          </View>
          <View className="flex-row justify-between items-center mt-2">
            <Txt mono className="text-[11px] text-text2">
              {t('common.approxUsd', { usd: `$${(Number(amount) * mlPrice).toFixed(2)}` })}
            </Txt>
            <PctButtons compact onPick={(f) => setAmount(String(Math.round((assets.mlBalance ?? 0) * f * 1e4) / 1e4))} />
          </View>
          <View className="mt-3">
            <Label className="mb-2">{t('swap.offer.timelock')}</Label>
            <Segmented options={[...TIMELOCK_CHOICES]} value={timelock} onChange={setTimelock} variant="tabs" />
            <Txt mono className="text-[10px] text-text3 mt-2">
              {t('swap.step.matchDetail')}
            </Txt>
          </View>
        </Card>
      </View>

      {/* Sessions: the live protocol steps and the refund path. */}
      <View className="px-5 pt-5">
        <Label className="mb-3">{t('swap.session.title')}</Label>
        {sessions !== null && sessions.length === 0 && (
          <Card className="p-4">
            <Txt className="text-[11px] text-text2">{t('swap.session.empty')}</Txt>
          </Card>
        )}
        {sessions?.map((session) => (
          <Card key={session.id} grad={G.raisedAmber} className="p-4 mb-3">
            <View className="flex-row justify-between items-center mb-3">
              <Txt mono className="text-[10px] text-text3">
                {session.id.slice(0, 18)}…
              </Txt>
              <Txt mono className="text-[10px]" style={{ color: stateTone(session.state) }}>
                {t(stateCopyKey(session.state))}
              </Txt>
            </View>
            <HtlcRail />
            <Steps steps={stepsFor(session)} />
            {session.lockTxHex && (session.state === 'offered' || session.state === 'locked') && (
              <Btn tone="ghost" className="mt-2" disabled={busy} onPress={() => void refund(session)}>
                {t('swap.refund.cta')}
              </Btn>
            )}
          </Card>
        ))}
      </View>

      <View className="px-5 pt-1 pb-6">
        <Btn tone="primary" disabled={busy} onPress={() => void initiate()}>
          {busy ? t('swap.state.pending') : t('swap.initiate')}
        </Btn>
      </View>
    </Screen>
  );
}

/** Provider assets without the useData fixture bundle: balances ride the
 *  provider asset rows (the same source the picker panels used). */
function useDataCompat(): { mlBalance: number | null; priceMap: Record<string, number> } {
  const { data } = useProviders();
  const [state, setState] = useState<{ mlBalance: number | null; priceMap: Record<string, number> }>({ mlBalance: null, priceMap: {} });
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const rows = await data.getAssets();
        if (!live) return;
        setState({
          mlBalance: rows.find((row) => row.sym === 'ML')?.amt ?? 0,
          priceMap: Object.fromEntries(rows.map((row) => [row.sym, row.price] as const)),
        });
      } catch {
        if (live) setState({ mlBalance: null, priceMap: {} });
      }
    })();
    return () => {
      live = false;
    };
  }, [data]);
  return state;
}

function toAtoms(decimal: string): string {
  const cleaned = decimal.trim();
  if (!/^\d*(?:\.\d*)?$/.test(cleaned) || cleaned.length === 0) return '0';
  const [int, frac = ''] = cleaned.split('.');
  const padded = frac.slice(0, ML_DECIMALS).padEnd(ML_DECIMALS, '0');
  return `${int || '0'}${padded}`.replace(/^0+(?=\d)/, '') || '0';
}

/** Indicative want leg (mock price source, R1): 1 ML at the fixture USDT
 *  price; the swap is the ML-side HTLC demo, so the want leg is disclosure
 *  only, never a money figure the flow depends on. */
function wantAtomsOf(amountDecimal: string): string {
  return toAtoms(String(Number(amountDecimal) * 0.343));
}

function rateOf(amountDecimal: string, priceMap: Record<string, number>): string {
  const price = priceMap.ML ?? 0;
  const usdValue = Number(amountDecimal) * price;
  return usdValue > 0 ? `$${usdValue.toFixed(2)}` : '-';
}

/** Swap preimage source per mode: the native secure random in real mode
 *  (device-pending honest state until the bindings verify), the mock hash
 *  helper in demo mode. The bytes live only in the screen closure. */
async function swapSecret(mode: 'mock' | 'real'): Promise<Uint8Array> {
  if (mode === 'real') return MojitoCore.secureRandom(32);
  const bytes = new Uint8Array(32);
  let seed = fnv1a(`swap-demo:${Date.now()}`);
  for (let i = 0; i < 32; i++) {
    seed = fnv1a(String(seed), 0x9e3779b9);
    bytes[i] = seed & 0xff;
  }
  return bytes;
}

function swapErrorCopy(e: unknown): string {
  if (isBindingsUnavailable(e)) return t('swap.error.devicePending');
  const record = e as { reason?: string; failure?: string } | null;
  if (record && typeof record.failure === 'string' && record.failure === 'unsupported') return t('swap.real.unavailable');
  if (record && typeof record.reason === 'string') {
    if (record.reason === 'broadcast-disabled') return t('swap.broadcastOff');
    if (record.reason === 'not-expired') return t('errors.htlc.expired');
    if (record.reason === 'no-htlc-output') return t('errors.htlc.noOutput');
  }
  return t('swap.error.generic');
}

function stateCopyKey(state: SwapState): I18nKey {
  switch (state) {
    case 'offered': return 'swap.state.offered';
    case 'locked': return 'swap.state.locked';
    case 'claiming': return 'swap.state.claiming';
    case 'settled': return 'swap.state.settled';
    case 'refunded': return 'swap.state.refunded';
    case 'expired': return 'swap.state.expired';
  }
}

function stateTone(state: SwapState): string {
  switch (state) {
    case 'settled': return C.green;
    case 'refunded': return C.teal;
    case 'expired': return C.text3;
    default: return C.amber;
  }
}

/** The four protocol steps (the M0 HTLC_STEPS fixture became these live session steps). */
function stepsFor(session: SwapSessionRow): { label: string; detail: string; state: StepState; note?: string }[] {
  const done = session.state === 'settled' || session.state === 'refunded';
  const lockState: StepState = session.state === 'offered' ? 'active' : 'done';
  const matchState: StepState = session.state === 'locked' ? 'active' : lockState === 'done' ? (done ? 'done' : session.state === 'claiming' ? 'done' : 'pending') : 'pending';
  const claimState: StepState = session.state === 'claiming' ? 'active' : session.state === 'settled' ? 'done' : 'pending';
  const settleState: StepState = session.state === 'settled' ? 'done' : 'pending';
  const hours = Math.round(session.offer.timelockSeconds / 3600);
  return [
    { label: t('swap.step.lock'), detail: t('swap.step.lockDetail', { hours: String(hours) }), state: session.state === 'refunded' || session.state === 'expired' ? 'done' : lockState },
    { label: t('swap.step.match'), detail: t('swap.step.matchDetail'), state: matchState },
    { label: t('swap.step.claim'), detail: t('swap.step.claimDetail'), state: claimState },
    { label: t('swap.step.settle'), detail: t('swap.step.settleDetail'), state: settleState, note: session.state === 'refunded' ? t('swap.state.refunded') : undefined },
  ];
}

/** BTC ⇄ ML rail with a lock badge and packets travelling across it. */
function HtlcRail() {
  return (
    <View className="h-20 mb-3 justify-center">
      <Svg width="100%" height={80} viewBox="0 0 300 80">
        <Defs>
          <SvgGrad id="rail" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.amber} />
            <Stop offset="1" stopColor={C.teal} />
          </SvgGrad>
        </Defs>
        <Circle cx={40} cy={40} r={22} fill="none" stroke={C.amber} strokeWidth={1.5} />
        <SvgText x={40} y={46} textAnchor="middle" fontSize={14} fill={C.amber} fontWeight="600">
          ₿
        </SvgText>
        <Circle cx={260} cy={40} r={22} fill="none" stroke={C.teal} strokeWidth={1.5} />
        <SvgText x={260} y={46} textAnchor="middle" fontSize={14} fill={C.teal} fontWeight="600">
          Ⓜ
        </SvgText>
        <Line x1={64} y1={40} x2={236} y2={40} stroke="url(#rail)" strokeWidth={2} strokeDasharray="3 4" opacity={0.6} />
        <Rect x={136} y={26} width={28} height={24} rx={6} fill={C.bg1} stroke={C.amber} strokeWidth={1} />
        <SvgText x={150} y={43} textAnchor="middle" fontSize={11} fill={C.amber}>
          ⚷
        </SvgText>
      </Svg>
      {[0, 800, 1600].map((d) => (
        <View key={d} className="absolute left-[64px] right-[64px] h-1.5 top-[37px]" pointerEvents="none">
          <FlowX track={172} duration={2400} delay={d}>
            <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.amber }} />
          </FlowX>
        </View>
      ))}
    </View>
  );
}
