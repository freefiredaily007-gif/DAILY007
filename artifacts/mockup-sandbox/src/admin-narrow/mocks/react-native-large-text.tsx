import React from "react";
import * as Native from "react-native-web";

export * from "react-native-web";

function getPreviewFontScale() {
  const scale = Number(
    (globalThis as typeof globalThis & { __daily007LargeTextScale?: number })
      .__daily007LargeTextScale,
  );
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function scaleTextStyle(style: unknown) {
  const scale = getPreviewFontScale();
  const flattened = Native.StyleSheet.flatten(style as any) as Record<string, unknown> | undefined;
  const scaled: Record<string, number> = {};
  if (typeof flattened?.fontSize === "number") scaled.fontSize = flattened.fontSize * scale;
  if (typeof flattened?.lineHeight === "number") scaled.lineHeight = flattened.lineHeight * scale;
  return [style, scaled];
}

export const Text = React.forwardRef<any, any>((props, ref) => (
  <Native.Text {...props} ref={ref} style={scaleTextStyle(props.style)} />
));
Text.displayName = "LargeTextPreviewText";

export const TextInput = React.forwardRef<any, any>((props, ref) => (
  <Native.TextInput {...props} ref={ref} style={scaleTextStyle(props.style)} />
));
TextInput.displayName = "LargeTextPreviewTextInput";

export const Platform = { ...Native.Platform, OS: "android", Version: 35 } as typeof Native.Platform;

export const PixelRatio = {
  ...Native.PixelRatio,
  getFontScale: getPreviewFontScale,
} as typeof Native.PixelRatio;

export function useWindowDimensions() {
  return {
    ...Native.useWindowDimensions(),
    fontScale: getPreviewFontScale(),
  };
}