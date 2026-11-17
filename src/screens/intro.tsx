import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { C, G, alpha, white } from '../theme';
import { t } from '../i18n';
import { Enter, FlowX, MojitoLogo, PulseRings, Txt, gradColors } from '../ui';

// The onboarding flow itself lives in src/onboarding; this file is just the
// cold-start splash that runs before it.

/** Particles converge into the mark, then the wordmark and tagline reveal. */
export function Splash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState(0);
  const converge = useRef(new Animated.Value(0)).current;

  // Deterministic scatter: no Math.random, so the field is stable across renders.
  const particles = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const angle = (i / 28) * Math.PI * 2;
        const r = 80 + ((i * 37) % 60);
        return {
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r,
          size: 3 + ((i * 13) % 4),
          color: i % 3 === 0 ? C.amber : i % 3 === 1 ? C.teal : C.violet,
        };
      }),
    [],
  );

  useEffect(() => {
    Animated.timing(converge, { toValue: 1, duration: 1100, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start();
    const timers = [
      setTimeout(() => setPhase(1), 1100),
      setTimeout(() => setPhase(2), 1700),
      setTimeout(() => setPhase(3), 2900),
      setTimeout(onDone, 3500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [converge, onDone]);

  return (
    <View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: C.bg0, zIndex: 100 }}>
      <LinearGradient colors={gradColors(G.splash)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

      <View className="w-[200px] h-[200px] items-center justify-center">
        {particles.map((p, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              backgroundColor: p.color,
              opacity: converge.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.9, 0.9, 0] }),
              transform: [
                { translateX: converge.interpolate({ inputRange: [0, 1], outputRange: [p.x, 0] }) },
                { translateY: converge.interpolate({ inputRange: [0, 1], outputRange: [p.y, 0] }) },
              ],
            }}
          />
        ))}

        {phase >= 1 && (
          <>
            <PulseRings size={80} color={alpha(C.amber, 0.6)} count={3} />
            <Enter duration={700} offset={0}>
              <MojitoLogo size={92} />
            </Enter>
          </>
        )}
      </View>

      {phase >= 1 && (
        <Enter duration={600} delay={200}>
          <Txt className="text-[32px] font-bold tracking-tightest mt-7" style={{ color: C.amber }}>
            mojito
          </Txt>
        </Enter>
      )}

      {phase >= 2 && (
        <Enter duration={500} offset={6}>
          <Txt className="text-[12px] text-text2 tracking-widest mt-1.5">{t('splash.tagline')}</Txt>
        </Enter>
      )}

      <View className="absolute bottom-[130px] w-[180px] h-0.5 rounded-full overflow-hidden" style={{ backgroundColor: white(0.06) }}>
        {phase >= 1 && phase < 3 && (
          <FlowX track={180} duration={1400}>
            <View className="w-[60px] h-full rounded-full" style={{ backgroundColor: C.amber }} />
          </FlowX>
        )}
      </View>

      {phase >= 2 && <Txt className="absolute bottom-[92px] text-[11px] text-text3 tracking-wider">{t('splash.status')}</Txt>}
    </View>
  );
}
