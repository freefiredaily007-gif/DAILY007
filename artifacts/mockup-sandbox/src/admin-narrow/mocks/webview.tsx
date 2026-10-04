import React from "react";
import { View } from "react-native";

export default function WebView({ style }: { style?: unknown }) {
  return <View testID="large-text-preview-webview" style={style as any} />;
}