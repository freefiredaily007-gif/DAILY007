import React, { createContext, useContext } from 'react';
import {
  Text as NativeText,
  TextInput as NativeTextInput,
  StyleSheet,
} from 'react-native';
import type { TextInputProps, TextProps, TextStyle } from 'react-native';

const TYPE_SCALE = 1.18;
const DEFAULT_TEXT_SIZE = 16;
const InheritedFontSize = createContext<number | null>(null);

const TEXT_COLOR = {
  white: '#F5F7FF',
  yellow: '#FFD54D',
  blue: '#70B8FF',
  deepBlue: '#173B6C',
} as const;

const SEMANTIC_STATUS_COLORS = new Set([
  '#ff5c5c', '#ff9aa5', '#fca5a5', '#ffb4b4',
  '#2ecc71', '#86efac', '#c9f7d4',
]);

const scaleSize = (value: number) => Math.round(value * TYPE_SCALE * 10) / 10;

function colorProfile(color: unknown) {
  if (typeof color !== 'string') return null;
  const value = color.trim().toLowerCase();
  let channels: number[] | null = null;

  const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      channels = hex.slice(0, 3).split('').map((part) => parseInt(part + part, 16));
    } else if (hex.length === 6 || hex.length === 8) {
      channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
    }
  } else {
    const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(value);
    if (rgbMatch) channels = rgbMatch.slice(1, 4).map(Number);
  }

  if (!channels) return null;
  const [red, green, blue] = channels.map((channel) => Math.max(0, Math.min(255, channel)) / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }

  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const hex = `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
  return { hue, lightness, saturation, hex };
}

function numericWeight(style: TextStyle) {
  const weight = String(style.fontWeight ?? '400');
  if (weight === 'bold') return 700;
  if (weight === 'normal') return 400;
  const parsed = Number.parseInt(weight, 10);
  return Number.isNaN(parsed) ? 400 : parsed;
}

function paletteTextColor(color: unknown, style: TextStyle, role: 'text' | 'body' | 'supporting' = 'text') {
  const profile = colorProfile(color);
  if (profile && SEMANTIC_STATUS_COLORS.has(profile.hex)) return profile.hex;

  if (role === 'supporting') return TEXT_COLOR.blue;
  if (role === 'body') return TEXT_COLOR.white;

  const isPureWhite = profile && profile.lightness > 0.98 && profile.saturation < 0.1;
  const isHeading = numericWeight(style) >= 700 && (
    (typeof style.fontSize === 'number' && style.fontSize >= 16) ||
    (typeof style.letterSpacing === 'number' && style.letterSpacing >= 0.8)
  );
  if (isPureWhite) return TEXT_COLOR.white;
  if (profile && profile.saturation > 0.22 && profile.hue >= 20 && profile.hue <= 70) {
    return TEXT_COLOR.yellow;
  }
  if (profile && profile.saturation > 0.2 && profile.hue >= 185 && profile.hue <= 285) {
    return TEXT_COLOR.blue;
  }
  if (isHeading) return TEXT_COLOR.yellow;
  if (profile && profile.saturation < 0.22 && profile.lightness < 0.18) {
    return TEXT_COLOR.deepBlue;
  }
  if (profile && profile.saturation < 0.22 && profile.lightness < 0.75) {
    return TEXT_COLOR.blue;
  }
  return TEXT_COLOR.white;
}

function boldFontFamily(style: TextStyle) {
  return typeof style.fontFamily === 'string' && style.fontFamily.startsWith('Inter_')
    ? 'Inter_700Bold'
    : undefined;
}

export function ReadableText({ children, style, ...props }: TextProps) {
  const inheritedSize = useContext(InheritedFontSize);
  const flattenedStyle = StyleSheet.flatten(style);
  const ownFontSize = typeof flattenedStyle?.fontSize === 'number'
    ? scaleSize(flattenedStyle.fontSize)
    : undefined;
  const fontSize = ownFontSize ?? (inheritedSize === null ? DEFAULT_TEXT_SIZE : undefined);
  const lineHeight = typeof flattenedStyle?.lineHeight === 'number'
    ? scaleSize(flattenedStyle.lineHeight)
    : undefined;
  const effectiveSize = fontSize ?? inheritedSize ?? DEFAULT_TEXT_SIZE;
  const textColor = paletteTextColor(flattenedStyle?.color, flattenedStyle || {});
  const fontFamily = boldFontFamily(flattenedStyle || {});

  return (
    <NativeText
      {...props}
      style={[
        style,
        {
          fontSize,
          lineHeight,
          color: textColor,
          fontWeight: '800',
          ...(fontFamily ? { fontFamily } : {}),
        },
      ]}
    >
      <InheritedFontSize.Provider value={effectiveSize}>
        {children}
      </InheritedFontSize.Provider>
    </NativeText>
  );
}

export function ReadableTextInput({ style, ...props }: TextInputProps) {
  const flattenedStyle = StyleSheet.flatten(style);
  const fontSize = typeof flattenedStyle?.fontSize === 'number'
    ? scaleSize(flattenedStyle.fontSize)
    : DEFAULT_TEXT_SIZE;
  const lineHeight = typeof flattenedStyle?.lineHeight === 'number'
    ? scaleSize(flattenedStyle.lineHeight)
    : undefined;
  const fontFamily = boldFontFamily(flattenedStyle || {});
  const textColor = paletteTextColor(flattenedStyle?.color, flattenedStyle || {}, 'body');
  const placeholderTextColor = paletteTextColor(
    props.placeholderTextColor,
    flattenedStyle || {},
    'supporting',
  );

  return (
    <NativeTextInput
      {...props}
      placeholderTextColor={placeholderTextColor}
      style={[
        style,
        {
          fontSize,
          lineHeight,
          color: textColor,
          fontWeight: '700',
          ...(fontFamily ? { fontFamily } : {}),
        },
      ]}
    />
  );
}