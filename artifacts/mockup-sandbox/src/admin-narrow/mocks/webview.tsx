import React from "react";
import { Pressable, Text, View } from "react-native";

type WebViewProps = {
  style?: unknown;
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
};

function sendMessage(onMessage: WebViewProps["onMessage"], message: Record<string, unknown>) {
  onMessage?.({ nativeEvent: { data: JSON.stringify(message) } });
}

export default function WebView({ style, onMessage }: WebViewProps) {
  const rewardPreview = Boolean(
    (globalThis as typeof globalThis & { __videoRewardPreview?: boolean })
      .__videoRewardPreview,
  );
  React.useEffect(() => {
    if (!rewardPreview) return undefined;
    const preview = globalThis as typeof globalThis & {
      __sendVideoRewardPreviewProgress?: (currentTime: number, duration?: number) => void;
    };
    const sendProgress = (currentTime: number, duration = 8) => {
      sendMessage(onMessage, {
        type: "progress",
        currentTime,
        duration,
        playing: true,
      });
    };
    preview.__sendVideoRewardPreviewProgress = sendProgress;
    return () => {
      if (preview.__sendVideoRewardPreviewProgress === sendProgress) {
        preview.__sendVideoRewardPreviewProgress = undefined;
      }
    };
  }, [onMessage, rewardPreview]);
  return (
    <View testID="large-text-preview-webview" style={style as any}>
      {rewardPreview ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Simulate video playback start"
            testID="video-preview-start-playback"
            onPress={() => {
              sendMessage(onMessage, { type: "ready" });
              sendMessage(onMessage, {
                type: "progress",
                currentTime: 0,
                duration: 8,
                playing: true,
              });
            }}
          >
            <Text>Simulate video playback start</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Simulate completed video"
            testID="video-preview-finish-playback"
            onPress={() => {
              for (let currentTime = 1; currentTime <= 7; currentTime += 1) {
                const preview = globalThis as typeof globalThis & {
                  __daily007VideoNow?: number;
                };
                preview.__daily007VideoNow = (preview.__daily007VideoNow ?? Date.now()) + 1_000;
                sendMessage(onMessage, {
                  type: "progress",
                  currentTime,
                  duration: 8,
                  playing: true,
                });
              }
              sendMessage(onMessage, { type: "state", state: 0 });
            }}
          >
            <Text>Simulate completed video</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
