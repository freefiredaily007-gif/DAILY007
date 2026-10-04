import React from "react";
import { ScrollView, type ScrollViewProps } from "react-native";

type Props = ScrollViewProps & {
  bottomOffset?: number;
  enabled?: boolean;
};

export function KeyboardAwareScrollView({
  bottomOffset: _bottomOffset,
  enabled: _enabled,
  ...props
}: Props) {
  return <ScrollView {...props} />;
}