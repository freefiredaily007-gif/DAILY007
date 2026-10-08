import React from "react";
import * as Native from "react-native-web";

export * from "react-native-web";

const NativeComponents = Native as any;
const previewPlatform =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("platform") === "ios"
    ? "ios"
    : "android";

type PreviewAnnouncement = { message: string; options?: unknown };
type PreviewAccessibilityGlobal = typeof globalThis & {
  __daily007AccessibilityAnnouncements?: PreviewAnnouncement[];
};

function captureAccessibilityAnnouncement(message: string, options?: unknown) {
  const preview = globalThis as PreviewAccessibilityGlobal;
  preview.__daily007AccessibilityAnnouncements ??= [];
  preview.__daily007AccessibilityAnnouncements.push({ message, options });
}

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

export function RefreshControl(props: any) {
  const manualRefreshPreview = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("manual-refresh-only");
  if (!manualRefreshPreview) return <NativeComponents.RefreshControl {...props} />;
  return (
    <NativeComponents.View style={props.style}>
      <NativeComponents.Pressable
        testID="player-refresh-control-test-action"
        accessibilityRole="button"
        accessibilityLabel="Pull to refresh"
        onPress={props.onRefresh}
        style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
      >
        <Native.Text>Pull to refresh</Native.Text>
      </NativeComponents.Pressable>
      <Native.Text testID="player-refresh-control-pending">
        {props.refreshing ? "Refreshing" : "Ready"}
      </Native.Text>
      {props.children}
    </NativeComponents.View>
  );
}

export const BackHandler = {
  addEventListener: () => ({ remove: () => {} }),
  removeEventListener: () => {},
  exitApp: () => {},
};

export const AccessibilityInfo = {
  ...(NativeComponents.AccessibilityInfo ?? {}),
  announceForAccessibility: captureAccessibilityAnnouncement,
  announceForAccessibilityWithOptions: captureAccessibilityAnnouncement,
} as typeof NativeComponents.AccessibilityInfo;

export const Platform = { ...Native.Platform, OS: previewPlatform, Version: 35 } as typeof Native.Platform;

export const PixelRatio = {
  ...Native.PixelRatio,
  getFontScale: getPreviewFontScale,
} as typeof Native.PixelRatio;

type PreviewAlertButton = {
  text?: string;
  onPress?: () => unknown;
};

type PreviewAlertState = {
  kind: "alert" | "prompt";
  title: string;
  message?: string;
  buttons?: string[];
  choose?: (label: string) => unknown;
  submit?: (value: string) => unknown;
};

type PreviewAlertGlobal = typeof globalThis & {
  __daily007AdminAlert?: PreviewAlertState;
};

export const Alert = {
  alert(title: string, message?: string, buttons: PreviewAlertButton[] = []) {
    (globalThis as PreviewAlertGlobal).__daily007AdminAlert = {
      kind: "alert",
      title,
      message,
      buttons: buttons.map((button) => button.text ?? ""),
      choose: (label) => buttons.find((button) => button.text === label)?.onPress?.(),
    };
  },
  prompt(title: string, message: string, onSubmit: (value: string) => unknown) {
    (globalThis as PreviewAlertGlobal).__daily007AdminAlert = {
      kind: "prompt",
      title,
      message,
      submit: (value) => onSubmit(value),
    };
  },
};

export function useWindowDimensions() {
  return {
    ...Native.useWindowDimensions(),
    fontScale: getPreviewFontScale(),
  };
}