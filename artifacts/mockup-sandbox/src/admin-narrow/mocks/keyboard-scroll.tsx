import React from "react";
import { ScrollView } from "react-native";

export function KeyboardAwareScrollViewCompat(props: React.ComponentProps<typeof ScrollView>) {
  return <ScrollView {...props} />;
}