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
import JoinForm from "../../../daily007/src/screens/JoinForm";
import LeaderboardDetails from "../../../daily007/src/screens/LeaderboardDetails";
import { getPlayerTabBarHeight } from "../../../daily007/src/lib/playerTabBarSizing";
import { configurePlayerLargestTextPreview, configureWalletFormPreview } from "./mocks/api";
import {
  configurePasswordChangePreview,
  configureVideoRewardPreview,
} from "./mocks/api-client-react";
import { configurePreviewNetwork } from "./mocks/network";

function JoinFormServerErrorPreview() {
  return (
    <JoinForm
      tournament={{
        id: "join-error-preview-match",
        name: "Server error test match",
        mode: "Battle Royale",
        teamType: "Solo",
        teamSize: 1,
        slotUnit: "player",
        status: "open",
        enabled: true,
        capacity: 8,
        totalSlots: 8,
        filledSlots: 1,
        remainingSlots: 7,
        entryCoins: 7,
        startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      }}
      user={{ name: "Test Player", gameUid: "FF-TEST-PLAYER" }}
      onCancel={() => {}}
      onSubmit={async () => {
        const error = new Error("Request failed with status code 409");
        error.response = { data: { error: "Insufficient wallet balance: this entry costs 7 coins." } };
        throw error;
      }}
    />
  );
}

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
  JoinForm: JoinFormServerErrorPreview,
  LeaderboardDetails,
};

const titles = {
  Tournaments: "MATCHES",
  MyMatches: "MY MATCHES",
  Leaderboard: "LEADERBOARD",
  Notifications: "NOTIFICATIONS",
  EditProfile: "EDIT PROFILE",
  JoinForm: "REGISTER",
  LeaderboardDetails: "LEADERBOARD DETAILS",
};

const tabScreens = ["Home", "Video", "Earn", "Wallet", "Profile"];
const tabLabels = ["HOME", "VIDEO", "EARN", "WALLET", "PROFILE"];
const screenName = new URLSearchParams(window.location.search).get("screen") || "Home";
const videoRewardPreviewMode = screenName === "VideoUnavailable"
  ? "unavailable"
  : screenName === "VideoTransient"
    ? "transient"
    : screenName === "VideoLateCompletion"
      ? "lateCompletion"
    : screenName === "VideoStartFailure"
      ? "startFailure"
        : screenName === "VideoDelayedStart"
          ? "delayedStart"
      : screenName === "VideoRefreshFailure"
        ? "unavailableRefreshFailure"
        : screenName === "VideoCatalogRetryPending"
          ? "catalogRefreshPending"
        : screenName === "VideoLateCatalogResponse"
          ? "lateCatalogResponse"
          : screenName === "VideoCatalogPositionRefreshFailure"
            ? "catalogPositionRefreshFailure"
        : screenName === "VideoConnectivityRecovery"
          ? "connectivityRecovery"
      : null;
const Screen = screens[screenName === "VideoUnavailable"
  || screenName === "VideoTransient"
  || screenName === "VideoLateCompletion"
  || screenName === "VideoStartFailure"
  || screenName === "VideoDelayedStart"
  || screenName === "VideoRefreshFailure"
  || screenName === "VideoCatalogRetryPending"
  || screenName === "VideoLateCatalogResponse"
  || screenName === "VideoCatalogPositionRefreshFailure"
  || screenName === "VideoConnectivityRecovery"
  ? "Video"
  : screenName] || Home;

configurePlayerLargestTextPreview();
configureWalletFormPreview();
configureVideoRewardPreview(videoRewardPreviewMode);
if (screenName === "VideoConnectivityRecovery") configurePreviewNetwork(false);
configurePasswordChangePreview();
if (videoRewardPreviewMode) window.__videoRewardPreview = true;

function PreviewTabBar({ fontScale, width }) {
  const height = getPlayerTabBarHeight(fontScale, width);
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
  const { width, fontScale } = useWindowDimensions();
  const [leaderboardCycleType, setLeaderboardCycleType] = React.useState("weekly");
  const hasTabBar = tabScreens.includes(screenName);

  return (
    <View
      testID="preview-frame"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: "#080b12" }}
    >
      {!hasTabBar ? <PreviewStackHeader title={titles[screenName] || screenName.toUpperCase()} /> : null}
      <View testID="player-screen" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {screenName === "LeaderboardDetails" ? (
          <Screen
            route={{ params: { cycleType: leaderboardCycleType } }}
            navigation={{ setParams: (params) => setLeaderboardCycleType(params.cycleType) }}
          />
        ) : (
          <Screen />
        )}
      </View>
      {hasTabBar ? <PreviewTabBar fontScale={fontScale} width={width} /> : null}
    </View>
  );
}

createRoot(document.getElementById("root")).render(<PlayerLargeTextPreview />);