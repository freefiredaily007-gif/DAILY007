import React from "react";
import { Pressable, Text } from "react-native";

export default function GoogleSSOButton({ label = "Connect Google" }: { label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }}
    >
      <Text style={{ fontSize: 14, textAlign: "center" }}>{label}</Text>
    </Pressable>
  );
}