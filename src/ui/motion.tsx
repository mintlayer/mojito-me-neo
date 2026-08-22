import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, ViewStyle } from 'react-native';

/**
 * Every looping animation in the design (spin-slow, float-y, flow-x, ticker,
 * pulse-ring) is a 0->1 ramp on repeat. One hook, interpolated per use site.
 */
export function useLoop(duration = 1000, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [duration, delay, v]);
  return v;
}

/** One-shot entrance: the design's `fade-in` / `slide-up ...ms Nms ease forwards`. */
export function Enter({
  children,
  delay = 0,
  duration = 500,
  offset = 14,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  offset?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [delay, duration, v]);
  return (
    <Animated.View
      style={[
        style as ViewStyle,
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }] },
      ]}>
      {children}
    </Animated.View>
  );
}

/**
 * `shake` — replays whenever `trigger` flips truthy. Returns a style to spread
 * onto an Animated.View. Used by wrong PIN entry and wrong word chips.
 */
export function useShake(trigger: unknown) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!trigger) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 450, easing: Easing.linear, useNativeDriver: true }).start();
  }, [trigger, v]);
  return {
    transform: [
      { translateX: v.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -8, 8, -5, 5, 0] }) },
    ],
  };
}

/** `spin-slow` */
export function Spin({ children, duration = 18000, style }: { children: React.ReactNode; duration?: number; style?: ViewStyle }) {
  const v = useLoop(duration);
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={[style, { transform: [{ rotate }] }]}>{children}</Animated.View>;
}

/** `float-y` — 0 -> -amount -> 0 */
export function Float({
  children,
  duration = 4000,
  amount = 6,
  style,
}: {
  children: React.ReactNode;
  duration?: number;
  amount?: number;
  style?: ViewStyle;
}) {
  const v = useLoop(duration);
  const translateY = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -amount, 0] });
  return <Animated.View style={[style, { transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/** `ticker` — gentle opacity breathing. */
export function Ticker({ children, duration = 1200, style }: { children: React.ReactNode; duration?: number; style?: ViewStyle }) {
  const v = useLoop(duration);
  const opacity = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1, 0.6] });
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

/**
 * `flow-x` — a highlight sweeping left to right across its parent. The parent
 * must clip overflow and pass its width as `track`.
 */
export function FlowX({
  children,
  duration = 2400,
  track,
  delay = 0,
}: {
  children: React.ReactNode;
  duration?: number;
  track: number;
  delay?: number;
}) {
  const v = useLoop(duration, delay);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          opacity: v.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-track * 0.3, track * 1.3] }) }],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

/** `pulse-ring` — concentric rings expanding out of a circular badge. */
export function PulseRings({
  size,
  color,
  count = 3,
  duration = 1600,
}: {
  size: number;
  color: string;
  count?: number;
  duration?: number;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Ring key={i} size={size} color={color} duration={duration} delay={(i * duration) / count} />
      ))}
    </>
  );
}

function Ring({ size, color, duration, delay }: { size: number; color: string; duration: number; delay: number }) {
  const v = useLoop(duration, delay);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2] }) }],
      }}
    />
  );
}
