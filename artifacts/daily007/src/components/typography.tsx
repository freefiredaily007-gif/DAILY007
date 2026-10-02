import React, { createContext, useContext } from 'react';
import {
  Text as NativeText,
  TextInput as NativeTextInput,
  StyleSheet,
  TextProps,
  TextInputProps,
} from 'react-native';

const TYPE_SCALE = 1.18;
const DEFAULT_TEXT_SIZE = 16;
const InheritedFontSize = createContext<number | null>(null);

const scaleSize = (value: number) => Math.round(value * TYPE_SCALE * 10) / 10;

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

  return (
    <NativeText
      {...props}
      style={[
        style,
        fontSize !== undefined || lineHeight !== undefined
          ? { fontSize, lineHeight }
          : undefined,
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

  return (
    <NativeTextInput
      {...props}
      style={[style, { fontSize, lineHeight }]}
    />
  );
}