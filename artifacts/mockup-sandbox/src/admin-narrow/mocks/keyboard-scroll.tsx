import React from "react";
import { ScrollView } from "react-native";

type Props = React.ComponentProps<typeof ScrollView> & {
  bottomOffset?: number;
  enabled?: boolean;
};

export function KeyboardAwareScrollViewCompat({ bottomOffset: _bottomOffset, enabled: _enabled, ...props }: Props) {
  void _bottomOffset;
  void _enabled;
  return <ScrollView {...props} />;
}
