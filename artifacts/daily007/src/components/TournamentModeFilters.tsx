import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { ReadableText as Text } from './typography';
import { C } from './ui';
import type { GAME_MODE_FILTERS, TournamentModeFilterKey } from '../lib/tournamentModeFilterOptions';
import { translateExactText } from '../i18n';
import {
  nativeTextScaleTextProps,
  type NativeTextScaleLayoutObserver,
} from '../lib/nativeTextScaleLayout';

type ModeFilter = (typeof GAME_MODE_FILTERS)[number];

export function TournamentModeFilters({
  filters,
  counts,
  selectedMode,
  largeText,
  onSelect,
  onContainerLayout,
  onFilterLayout,
  onTextScaleLayout,
}: {
  filters: readonly ModeFilter[];
  counts: Partial<Record<TournamentModeFilterKey, number>>;
  selectedMode: TournamentModeFilterKey;
  largeText: boolean;
  onSelect: (key: TournamentModeFilterKey) => void;
  onContainerLayout?: (event: LayoutChangeEvent) => void;
  onFilterLayout?: (key: TournamentModeFilterKey, x: number, width: number) => void;
  onTextScaleLayout?: NativeTextScaleLayoutObserver;
}) {
  const renderFilter = (filter: ModeFilter) => {
    const count = counts[filter.key] ?? 0;
    const selected = selectedMode === filter.key;
    return (
      <Pressable
        key={filter.key}
        testID={`tournament-mode-tab-${filter.key}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${filter.name} tournaments, ${count}`}
        onPress={() => onSelect(filter.key)}
        onLayout={onFilterLayout
          ? (event) => onFilterLayout(
            filter.key,
            event.nativeEvent.layout.x,
            event.nativeEvent.layout.width,
          )
          : undefined}
        style={[
          styles.modeFilterTab,
          largeText && styles.modeFilterTabLarge,
          selected && { borderColor: filter.accent, backgroundColor: `${filter.accent}22` },
        ]}
      >
        <Text
          {...nativeTextScaleTextProps(`tournament-filter:${filter.key}`, onTextScaleLayout)}
          testID={`tournament-mode-tab-label-${filter.key}`}
          style={[
          styles.modeFilterText,
          largeText && styles.modeFilterTextLarge,
          selected && { color: filter.accent },
        ]}
        >
          {translateExactText(filter.title)} <Text style={[styles.modeFilterCount, selected && { color: filter.accent }]}>{count}</Text>
        </Text>
      </Pressable>
    );
  };

  if (largeText) {
    return (
      <View
        testID="tournament-mode-filter-wrap"
        onLayout={onContainerLayout}
        style={styles.modeFilterWrap}
      >
        {filters.map(renderFilter)}
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.modeFilterContent}
      style={styles.modeFilterScroll}
    >
      {filters.map(renderFilter)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  modeFilterScroll: { marginBottom: 10 },
  modeFilterContent: { gap: 8, paddingRight: 8, paddingBottom: 2 },
  modeFilterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  modeFilterTab: {
    minWidth: 88,
    minHeight: 38,
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  modeFilterTabLarge: { flexBasis: '47%', flexGrow: 1, minWidth: 0, minHeight: 50 },
  modeFilterText: { color: C.sub, fontSize: 10, fontWeight: '900', letterSpacing: 0.3, textAlign: 'center' },
  modeFilterTextLarge: {
    width: '100%',
    maxWidth: '100%',
    flexShrink: 1,
    fontSize: 12,
    letterSpacing: 0,
  },
  modeFilterCount: { color: C.dim, fontSize: 9, fontWeight: '800' },
});
