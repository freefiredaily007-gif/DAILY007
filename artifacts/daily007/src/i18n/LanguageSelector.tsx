import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { useDaily007Language } from './LanguageProvider';
import { LANGUAGE_OPTIONS } from './languagePreference';
import type { AppLanguage } from './languagePreference';
import { translateExactText } from './index';

export function LanguageSelector({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { language, setLanguage } = useDaily007Language();
  const [saveError, setSaveError] = useState(false);

  const select = async (next: AppLanguage) => {
    setSaveError(false);
    try {
      await setLanguage(next);
    } catch {
      setSaveError(true);
    }
  };

  return (
    <View style={[styles.wrap, compact && styles.compactWrap]}>
      <Text style={styles.heading}>App language</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={translateExactText('App language')}
        style={styles.options}
      >
        {LANGUAGE_OPTIONS.map((option) => {
          const selected = language === option.value;
          return (
            <Pressable
              key={option.value}
              testID={`language-option-${option.value}`}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              onPress={() => void select(option.value)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.optionPressed,
              ]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {saveError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Language preference couldn't be saved. Try again.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 10 },
  compactWrap: { marginTop: 4, marginBottom: 8 },
  heading: {
    color: '#AEBCE0',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  options: { flexDirection: 'row', gap: 8, width: '100%' },
  option: {
    flex: 1,
    minHeight: 44,
    minWidth: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#25345E',
    backgroundColor: '#0B1430',
  },
  optionSelected: {
    borderColor: '#FFC928',
    backgroundColor: '#152243',
    shadowColor: '#FFC928',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  optionPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  optionText: {
    color: '#C9D4F2',
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 13,
  },
  optionTextSelected: { color: '#FFD43B' },
  error: { color: '#FF8795', fontSize: 12, lineHeight: 17 },
});
