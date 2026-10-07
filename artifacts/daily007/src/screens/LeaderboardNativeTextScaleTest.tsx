import React from "react";
import { Redirect } from "expo-router";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { ReadableText as Text } from "../components/typography";
import { C } from "../components/ui";
import {
  LEADERBOARD_TEXT_SCALE_FIXTURE,
  type LeaderboardTextScaleCycle,
} from "../lib/leaderboardTextScaleFixture";
import LeaderboardDetails from "./LeaderboardDetails";

export default function LeaderboardNativeTextScaleTest({
  cycleType: initialCycle,
}: {
  cycleType: LeaderboardTextScaleCycle;
}) {
  if (!__DEV__) return <Redirect href="/" />;
  return <NativeFixtureRoute initialCycle={initialCycle} />;
}

function NativeFixtureRoute({ initialCycle }: { initialCycle: LeaderboardTextScaleCycle }) {
  const [cycleType, setCycleType] = React.useState<LeaderboardTextScaleCycle>(initialCycle);
  const { fontScale } = useWindowDimensions();
  const navigation = {
    setParams: (params: { cycleType?: LeaderboardTextScaleCycle }) => {
      if (params.cycleType) setCycleType(params.cycleType);
    },
  };
  const route = {
    params: {
      cycleType,
      __nativeLeaderboardTestFixture: LEADERBOARD_TEXT_SCALE_FIXTURE,
    },
  };
  const fixtureRoute = {
    ...route,
  };

  return (
    <View style={styles.screen}>
      <Text testID="leaderboard-native-text-scale-fixture-banner" style={styles.banner}>
        Native leaderboard fixture | {cycleType} | font scale {fontScale.toFixed(2)} | layout {fontScale >= 1.5 ? "large" : "compact"}
      </Text>
      <View style={styles.details}>
        <LeaderboardDetails navigation={navigation} route={fixtureRoute} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  banner: { color: C.sub, paddingHorizontal: 10, paddingVertical: 4, fontSize: 10 },
  details: { flex: 1, minHeight: 0 },
});
