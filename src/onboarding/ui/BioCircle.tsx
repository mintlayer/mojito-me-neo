import React from 'react';
import type { Bio, ScanPhase } from './types';
import { BioGlyph } from './BioGlyph';
import { C, alpha } from '../../theme';
import { Icon, PulseRings } from '../../ui';
import { Pressable, View } from 'react-native';

export function BioCircle({ bio, phase, onPress }: { bio: Bio; phase: ScanPhase; onPress: () => void }) {
  const ok = phase === 'ok';
  const tone = ok ? C.green : C.amber;
  return (
    <Pressable onPress={onPress} className="w-[110px] h-[110px] items-center justify-center self-center">
      {phase === 'scan' && <PulseRings size={110} color={alpha(C.amber, 0.5)} count={3} duration={1400} />}
      <View
        className="w-[110px] h-[110px] rounded-full items-center justify-center"
        style={{ backgroundColor: alpha(C.amber, 0.08), borderWidth: 1.5, borderColor: tone }}>
        {ok ? <Icon name="check" size={44} color={C.green} stroke={2.6} /> : <BioGlyph bio={bio} size={52} color={tone} stroke={1.3} />}
      </View>
    </Pressable>
  );
}

// Sheet now lives in src/ui; the wallet pickers use it too.

/* ── Checkbox ───────────────────────────────────────────────── */
