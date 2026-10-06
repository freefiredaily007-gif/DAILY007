import React from "react";
import { createRoot } from "react-dom/client";

const localAsset = () => ({ uri: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
globalThis.require = localAsset;
window.require = localAsset;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Tournament resume preview root is missing.");

const root = createRoot(rootElement);
const scheduledStartOnly = new URLSearchParams(location.search).has("scheduled-start-only");
const initialLoadFailureOnly = new URLSearchParams(location.search).has("initial-load-failure-only");
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const scheduledStartGapMs = 3_000;
const nextIstMidnightStart = (timestamp) => {
  const istNow = new Date(timestamp + IST_OFFSET_MS);
  return Date.UTC(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate() + 1,
    0,
    0,
    1,
  ) - IST_OFFSET_MS;
};
let scheduledStartMs = scheduledStartOnly
  ? nextIstMidnightStart(Date.now())
  : Date.now() + 10 * 60 * 1000;
let laterScheduledStartMs = scheduledStartMs + scheduledStartGapMs;
let fakeNow = scheduledStartMs - (scheduledStartOnly ? 2_000 : 60 * 1000);
Date.now = () => fakeNow;

let visibilityState = "visible";
let visibilityChangeCount = 0;
document.addEventListener("visibilitychange", () => { visibilityChangeCount += 1; });
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibilityState,
});

const asIstTimestamp = (timestamp) =>
  new Date(timestamp + IST_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, "+05:30");

const asIstTime = (timestamp) => {
  const hour = new Date(timestamp + IST_OFFSET_MS).getUTCHours();
  const minute = new Date(timestamp + IST_OFFSET_MS).getUTCMinutes();
  const hour12 = hour % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
};

const scheduledTournament = (id, name, startsAtMs) => {
  const startsAt = asIstTimestamp(startsAtMs);
  return {
    id,
    name,
    mode: "Battle Royale",
    teamType: "Solo",
    gameMode: "battle_royale",
    date: startsAt.slice(0, 10),
    time: asIstTime(startsAtMs),
    startsAt,
    entryCoins: 0,
    prizePool: 500,
    totalSlots: 48,
    filledSlots: 0,
    filledPlayerSlots: 0,
    totalPlayerSlots: 48,
    status: "upcoming",
    enabled: true,
    prizeDist: "1st: 500 coins",
  };
};

void import("./mocks/api.ts").then(async (apiMocks) => {
  const scheduledTournaments = [
    scheduledTournament("resume-boundary", "IST Start Boundary", scheduledStartMs),
  ];
  if (scheduledStartOnly) {
    scheduledTournaments.push(
      scheduledTournament("resume-boundary-later", "Later IST Tournament Boundary", laterScheduledStartMs),
    );
  }
  apiMocks.previewTournaments.splice(0, apiMocks.previewTournaments.length, ...scheduledTournaments);
  if (initialLoadFailureOnly) {
    apiMocks.failNextTournamentRead("Initial tournament request failed");
  }

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
    failNextTournamentRead: apiMocks.failNextTournamentRead,
    getVisibilityChangeCount: () => visibilityChangeCount,
    getVisibilityState: () => visibilityState,
    updateTournament: (updates) => Object.assign(apiMocks.previewTournaments[0], updates),
    getScheduledStartInfo: () => {
      const istStart = new Date(scheduledStartMs + IST_OFFSET_MS).toISOString();
      const istBeforeStart = new Date(fakeNow + IST_OFFSET_MS).toISOString();
      const istDate = new Date(scheduledStartMs + IST_OFFSET_MS);
      return {
        browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        startsAt: apiMocks.previewTournaments[0]?.startsAt,
        date: apiMocks.previewTournaments[0]?.date,
        time: apiMocks.previewTournaments[0]?.time,
        startMs: scheduledStartMs,
        istDate: istStart.slice(0, 10),
        istDateLabel: `${String(istDate.getUTCDate()).padStart(2, "0")} ${istDate.toLocaleString("en", {
          month: "short",
          timeZone: "UTC",
        }).toUpperCase()}`,
        istTime: istStart.slice(11, 19),
        beforeIstDate: istBeforeStart.slice(0, 10),
        beforeIstTime: istBeforeStart.slice(11, 19),
        utcDate: new Date(scheduledStartMs).toISOString().slice(0, 10),
      };
    },
    advanceClockPastFirstStart: () => { fakeNow = scheduledStartMs + 100; },
    advanceClockPastSecondStart: () => { fakeNow = laterScheduledStartMs + 100; },
    prepareAdminForScheduledStart: () => {
      scheduledStartMs = scheduledStartOnly
        ? nextIstMidnightStart(fakeNow)
        : fakeNow + 2_500;
      laterScheduledStartMs = scheduledStartMs + scheduledStartGapMs;
      fakeNow = scheduledStartMs - 2_000;
      Object.assign(
        apiMocks.previewTournaments[0],
        scheduledTournament("resume-boundary", "IST Start Boundary", scheduledStartMs),
      );
      if (scheduledStartOnly) {
        Object.assign(
          apiMocks.previewTournaments[1],
          scheduledTournament(
            "resume-boundary-later",
            "Later IST Tournament Boundary",
            laterScheduledStartMs,
          ),
        );
      }
      apiMocks.resetTournamentReadCount();
    },
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
    retryAfterInitialLoadFailure: () => {
      setVisibility("hidden");
      setVisibility("visible");
    },
    showAdmin: () => root.render(React.createElement(AdminTournaments)),
  };

  root.render(React.createElement(Tournaments));
});