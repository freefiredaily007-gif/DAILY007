import React from "react";
import { createRoot } from "react-dom/client";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { ReadableText } from "../../../daily007/src/components/typography";
import Home from "../../../daily007/src/screens/Home";
import Video from "../../../daily007/src/screens/Video";
import Earn from "../../../daily007/src/screens/Earn";
import Tournaments from "../../../daily007/src/screens/Tournaments";
import MyMatches from "../../../daily007/src/screens/MyMatches";
import Wallet from "../../../daily007/src/screens/Wallet";
import Profile from "../../../daily007/src/screens/Profile";
import Leaderboard from "../../../daily007/src/screens/Leaderboard";
import Notifications from "../../../daily007/src/screens/Notifications";
import EditProfile from "../../../daily007/src/screens/EditProfile";
import { getPlayerTabBarHeight } from "../../../daily007/src/lib/playerTabBarSizing";
import { configurePlayerLargestTextPreview, configureWalletFormPreview } from "./mocks/api";

const screens = {
  Home,
  Video,
  Earn,
  Tournaments,
  MyMatches,
  Wallet,
  Profile,
  Leaderboard,
  Notifications,
  EditProfile,
};

const titles = {
  Tournaments: "MATCHES",
  MyMatches: "MY MATCHES",
  Leaderboard: "LEADERBOARD",
  Notifications: "NOTIFICATIONS",
  EditProfile: "EDIT PROFILE",
};

const tabScreens = ["Home", "Video", "Earn", "Wallet", "Profile"];
const tabLabels = ["HOME", "VIDEO", "EARN", "WALLET", "PROFILE"];
const screenName = new URLSearchParams(window.location.search).get("screen") || "Home";
const Screen = screens[screenName] || Home;

configurePlayerLargestTextPreview();
configureWalletFormPreview();

function PreviewTabBar({ fontScale }) {
  const height = getPlayerTabBarHeight(fontScale);
  return (
    <View
      testID="player-tab-bar"
      accessibilityRole="tablist"
      style={{
        height,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 2,
        paddingTop: 6.5,
        paddingBottom: 8.5,
        backgroundColor: "#0d1220",
        borderTopWidth: 1,
        borderTopColor: "#2a3558",
        flexShrink: 0,
      }}
    >
      {tabScreens.map((name, index) => (
        <Pressable
          key={name}
          testID={`player-tab-${name.toLowerCase()}`}
          accessibilityRole="tab"
          accessibilityLabel={name}
          style={{
            flex: 1,
            minWidth: 0,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 2,
          }}
        >
          <View style={{ width: 26, height: 24, marginBottom: 1 }} />
          <ReadableText
            testID={`player-tab-label-${name.toLowerCase()}`}
            style={{ width: "100%", maxWidth: "100%", flexShrink: 1, color: "#f5f7ff", fontSize: 11.8, lineHeight: 14, fontWeight: "900", textAlign: "center" }}
          >
            {tabLabels[index]}
          </ReadableText>
        </Pressable>
      ))}
    </View>
  );
}

function PreviewStackHeader({ title }) {
  return (
    <View
      testID="preview-stack-header"
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 7,
        backgroundColor: "#101625",
        borderBottomWidth: 1,
        borderBottomColor: "#2a3558",
      }}
    >
      <Pressable
        testID="preview-back-button"
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={{ minWidth: 44, minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: "#f5f7ff", fontSize: 14 }}>‹ BACK</Text>
      </Pressable>
      <ReadableText style={{ color: "#f5f7ff", fontSize: 16, flex: 1, minWidth: 0 }}>
        {title}
      </ReadableText>
    </View>
  );
}

function PlayerLargeTextPreview() {
  const { fontScale } = useWindowDimensions();
  const hasTabBar = tabScreens.includes(screenName);

  return (
    <View
      testID="preview-frame"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: "#080b12" }}
    >
      {!hasTabBar ? <PreviewStackHeader title={titles[screenName] || screenName.toUpperCase()} /> : null}
      <View testID="player-screen" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <Screen />
      </View>
      {hasTabBar ? <PreviewTabBar fontScale={fontScale} /> : null}
    </View>
  );
}

createRoot(document.getElementById("root")).render(<PlayerLargeTextPreview />);