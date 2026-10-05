import React, { createContext, useContext } from 'react';
import {
  Text as NativeText,
  TextInput as NativeTextInput,
  StyleSheet,
} from 'react-native';
import type { TextInputProps, TextProps, TextStyle } from 'react-native';

const TYPE_SCALE = 1.24;
const DEFAULT_TEXT_SIZE = 16.8;
const InheritedTypography = createContext<{ fontSize: number | null; color: string | null }>({
  fontSize: null,
  color: null,
});

const TEXT_COLOR = {
  white: '#70B8FF',
  yellow: '#FFD54D',
  blue: '#F5F7FF',
  deepBlue: '#173B6C',
} as const;

const BLUE_THEME_COLORS = new Set(['#4da3ff', '#70b8ff', '#7aa2f7']);
const WHITE_THEME_COLORS = new Set(['#fff', '#ffffff', '#eef1f8', '#f4f2ef', '#e6e9ef', '#f5f7ff']);

export function swapThemeColor(color: string) {
  const normalized = color.trim().toLowerCase();
  if (BLUE_THEME_COLORS.has(normalized)) return TEXT_COLOR.blue;
  if (WHITE_THEME_COLORS.has(normalized)) return TEXT_COLOR.white;
  return color;
}

const PRESERVED_COLORS = new Set([
  '#ff5c5c', '#ff9aa5', '#fca5a5', '#ffb4b4',
  '#2ecc71', '#86efac', '#c9f7d4',
  '#ff3d3d', '#ff4655', '#ff4b36', '#a05cff', '#d9b8ff',
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
  return { hue, lightness, saturation, chroma: max - min, hex };
}

function numericWeight(style: TextStyle) {
  const familyWeight = typeof style.fontFamily === 'string'
    ? /Inter_(\d{3})/.exec(style.fontFamily)?.[1]
    : undefined;
  const weight = String(style.fontWeight ?? familyWeight ?? '400');
  if (weight === 'bold') return 700;
  if (weight === 'normal') return 400;
  const parsed = Number.parseInt(weight, 10);
  return Number.isNaN(parsed) ? 400 : parsed;
}

function paletteTextColor(color: unknown, style: TextStyle, role: 'text' | 'body' | 'supporting' = 'text') {
  const profile = colorProfile(color);
  if (profile && PRESERVED_COLORS.has(profile.hex)) return profile.hex;

  if (role === 'supporting') return TEXT_COLOR.blue;
  if (role === 'body') return TEXT_COLOR.white;

  if (profile?.hex === '#070a12') return profile.hex;
  const isPureWhite = profile && profile.lightness > 0.98 && profile.saturation < 0.1;
  const isHeading = numericWeight(style) >= 700 && (
    (typeof style.fontSize === 'number' && style.fontSize >= 16) ||
    (typeof style.letterSpacing === 'number' && style.letterSpacing >= 0.8)
  );
  if (isPureWhite) return TEXT_COLOR.white;
  if (profile && profile.lightness < 0.18) return TEXT_COLOR.deepBlue;
  if (profile && profile.chroma > 0.2 && profile.hue >= 20 && profile.hue <= 70) {
    return TEXT_COLOR.yellow;
  }
  if (profile && profile.chroma > 0.2 && profile.hue >= 195 && profile.hue <= 235) {
    return TEXT_COLOR.blue;
  }
  if (isHeading) return TEXT_COLOR.yellow;
  if (profile && profile.saturation < 0.22 && profile.lightness < 0.75) {
    const fontSize = typeof style.fontSize === 'number' ? style.fontSize : DEFAULT_TEXT_SIZE;
    const isSupportingLabel = fontSize <= 11.5 || (
      fontSize <= 13 &&
      (numericWeight(style) >= 600 || (style.letterSpacing ?? 0) >= 0.3)
    );
    return isSupportingLabel ? TEXT_COLOR.blue : TEXT_COLOR.white;
  }
  return TEXT_COLOR.white;
}

function boldFontFamily(style: TextStyle) {
  return typeof style.fontFamily === 'string' && style.fontFamily.startsWith('Inter_')
    ? 'Inter_700Bold'
    : undefined;
}

export function ReadableText({ children, style, ...props }: TextProps) {
  const inherited = useContext(InheritedTypography);
  const flattenedStyle = StyleSheet.flatten(style);
  const ownFontSize = typeof flattenedStyle?.fontSize === 'number'
    ? scaleSize(flattenedStyle.fontSize)
    : undefined;
  const fontSize = ownFontSize ?? (inherited.fontSize === null ? DEFAULT_TEXT_SIZE : undefined);
  const lineHeight = typeof flattenedStyle?.lineHeight === 'number'
    ? scaleSize(flattenedStyle.lineHeight)
    : undefined;
  const effectiveSize = fontSize ?? inherited.fontSize ?? DEFAULT_TEXT_SIZE;
  const textColor = flattenedStyle?.color !== undefined
    ? paletteTextColor(flattenedStyle.color, flattenedStyle || {})
    : inherited.color ?? paletteTextColor(undefined, flattenedStyle || {});
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
      <InheritedTypography.Provider value={{ fontSize: effectiveSize, color: textColor }}>
        {children}
      </InheritedTypography.Provider>
    </NativeText>
  );
}

export const ReadableTextInput = React.forwardRef<
  React.ComponentRef<typeof NativeTextInput>,
  TextInputProps
>(function ReadableTextInput({ style, ...props }, ref) {
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
  const paddingAdjustment: TextStyle = {};
  if (typeof flattenedStyle?.paddingVertical === 'number') {
    paddingAdjustment.paddingVertical = flattenedStyle.paddingVertical + 0.5;
  } else if (typeof flattenedStyle?.padding === 'number') {
    paddingAdjustment.padding = flattenedStyle.padding + 0.5;
  } else {
    if (typeof flattenedStyle?.paddingTop === 'number') {
      paddingAdjustment.paddingTop = flattenedStyle.paddingTop + 0.5;
    }
    if (typeof flattenedStyle?.paddingBottom === 'number') {
      paddingAdjustment.paddingBottom = flattenedStyle.paddingBottom + 0.5;
    }
  }

  return (
    <NativeTextInput
      ref={ref}
      {...props}
      placeholderTextColor={placeholderTextColor}
      style={[
        style,
        {
          fontSize,
          lineHeight,
          color: textColor,
          fontWeight: '700',
          ...paddingAdjustment,
          ...(fontFamily ? { fontFamily } : {}),
        },
      ]}
    />
  );
});