import React from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import JoinForm from "../../../daily007/src/screens/JoinForm";

function JoinFormLargeTextPreview() {
  return (
    <View
      testID="player-screen"
      style={{ flex: 1, minHeight: 0, overflow: "hidden", backgroundColor: "#080b12" }}
    >
      <JoinForm
        tournament={{
          id: "join-large-text-preview-match",
          name: "Daily007 Squad Finals",
          mode: "Battle Royale",
          teamType: "Squad",
          teamSize: 4,
          slotUnit: "team",
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
        onCancel={() => {
          window.__joinFormCancelCount += 1;
        }}
        onSubmit={async () => {
          const error = new Error("Request failed with status code 409");
          error.response = { data: { error: "Insufficient wallet balance: this entry costs 7 coins." } };
          throw error;
        }}
      />
    </View>
  );
}

createRoot(document.getElementById("root")).render(<JoinFormLargeTextPreview />);
