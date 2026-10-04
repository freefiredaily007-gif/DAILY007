import React from "react";
import { createRoot } from "react-dom/client";

const localAsset = () => ({ uri: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
globalThis.require = localAsset;
window.require = localAsset;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Tournament resume preview root is missing.");

const root = createRoot(rootElement);
const scheduledStartMs = Date.now() + 10 * 60 * 1000;
let fakeNow = scheduledStartMs - 60 * 1000;
Date.now = () => fakeNow;

let visibilityState = "visible";
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibilityState,
});

const asIstTimestamp = (timestamp) =>
  new Date(timestamp + 5.5 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "+05:30");

void import("./mocks/api.ts").then(async (apiMocks) => {
  apiMocks.previewTournaments.splice(0, apiMocks.previewTournaments.length, {
    id: "resume-boundary",
    name: "IST Start Boundary",
    mode: "Battle Royale",
    teamType: "Solo",
    gameMode: "battle_royale",
    date: asIstTimestamp(scheduledStartMs).slice(0, 10),
    time: "08:00 PM",
    startsAt: asIstTimestamp(scheduledStartMs),
    entryCoins: 0,
    prizePool: 500,
    totalSlots: 48,
    filledSlots: 0,
    filledPlayerSlots: 0,
    totalPlayerSlots: 48,
    status: "upcoming",
    enabled: true,
    prizeDist: "1st: 500 coins",
  });

  const [{ default: Tournaments }, { default: AdminTournaments }] = await Promise.all([
    import("../../../daily007/src/screens/Tournaments"),
    import("../../../daily007/src/screens/AdminTournaments"),
  ]);

  const setVisibility = (state) => {
    visibilityState = state;
    document.dispatchEvent(new Event("visibilitychange"));
  };

  window.__daily007TournamentResume = {
    ready: true,
    getTournamentReadCount: apiMocks.getTournamentReadCount,
    resetTournamentReadCount: apiMocks.resetTournamentReadCount,
    startBackgroundCycle: () => {
      setVisibility("hidden");
      fakeNow = scheduledStartMs + 60 * 1000;
      setVisibility("visible");
    },
    prepareAdmin: () => {
      fakeNow = scheduledStartMs - 60 * 1000;
      setVisibility("visible");
      apiMocks.resetTournamentReadCount();
    },
    showAdmin: () => root.render(React.createElement(AdminTournaments)),
  };

  root.render(React.createElement(Tournaments));
});