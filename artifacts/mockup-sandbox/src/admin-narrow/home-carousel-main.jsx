import React from "react";
import { createRoot } from "react-dom/client";

const localAsset = () => ({ uri: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
globalThis.require = localAsset;
window.require = localAsset;
globalThis.__previewNavigations = [];

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Home carousel preview root is missing.");

const root = createRoot(rootElement);
const realSetInterval = globalThis.setInterval.bind(globalThis);
const homePollIntervals = [];
const scheduledStartMs = Math.ceil((Date.now() + 5 * 60 * 1000) / 60_000) * 60_000;
let fakeNow = scheduledStartMs - 60_000;
let startTimerFired = false;
Date.now = () => fakeNow;

const expectedStartTimerDelay = scheduledStartMs - fakeNow + 20;
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
let shouldAccelerateStartTimer = true;
globalThis.setTimeout = (callback, delay, ...args) => {
  if (
    shouldAccelerateStartTimer &&
    typeof callback === "function" &&
    Math.abs(Number(delay) - expectedStartTimerDelay) <= 5
  ) {
    shouldAccelerateStartTimer = false;
    return realSetTimeout(() => {
      fakeNow = scheduledStartMs + 20;
      startTimerFired = true;
      callback(...args);
    }, 50);
  }
  return realSetTimeout(callback, delay, ...args);
};

const asIstTimestamp = (timestamp) =>
  new Date(timestamp + 5.5 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "+05:30");
const istTime = (timestamp) => {
  const shifted = new Date(timestamp + 5.5 * 60 * 60 * 1000);
  const hour = shifted.getUTCHours();
  const twelveHour = hour % 12 || 12;
  return `${String(twelveHour).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
};

void import("./mocks/api.ts").then(async (apiMocks) => {
  const tournament = (id, name, startsAt) => ({
    id,
    name,
    mode: "Battle Royale",
    teamType: "Solo",
    gameMode: "battle_royale",
    date: asIstTimestamp(startsAt).slice(0, 10),
    time: istTime(startsAt),
    startsAt: asIstTimestamp(startsAt),
    entryCoins: 0,
    prizePool: 500,
    totalSlots: 48,
    filledSlots: 2,
    filledPlayerSlots: 2,
    totalPlayerSlots: 48,
    status: "upcoming",
    enabled: true,
    prizeDist: "1st: 500 coins",
  });
  apiMocks.previewTournaments.splice(
    0,
    apiMocks.previewTournaments.length,
    tournament("starting-soon", "Starting at IST", scheduledStartMs),
    tournament("later-one", "Later Tournament One", scheduledStartMs + 60 * 60 * 1000),
    tournament("later-two", "Later Tournament Two", scheduledStartMs + 2 * 60 * 60 * 1000),
  );
  apiMocks.configureHomeCarouselRegistrationPreview();

  const [{ default: Home, mergeHomeTournamentItems }, { HOME_TOURNAMENT_REFRESH_INTERVAL_MS }] =
    await Promise.all([
      import("../../../daily007/src/screens/Home"),
      import("../../../daily007/src/lib/tournamentLifecycle"),
    ]);
  globalThis.setInterval = (callback, intervalMs, ...args) => {
    if (intervalMs === HOME_TOURNAMENT_REFRESH_INTERVAL_MS) {
      homePollIntervals.push({ callback, intervalMs });
    }
    return realSetInterval(callback, intervalMs, ...args);
  };
  window.__daily007HomeCarouselTest = {
    ready: true,
    scheduledStartMs,
    getFakeNow: () => fakeNow,
    didStartTimerFire: () => startTimerFired,
    getHomePollCount: () => homePollIntervals.length,
    getHomePollIntervalMs: () => homePollIntervals[0]?.intervalMs ?? null,
    fireHomePoll: () => {
      const homePoll = homePollIntervals[0];
      if (!homePoll) return false;
      homePoll.callback();
      return true;
    },
    getTournamentReadCount: apiMocks.getTournamentReadCount,
    getMyRegistrationReadCount: apiMocks.getMyRegistrationReadCount,
    setRegistrations: apiMocks.setHomeCarouselRegistrationPreview,
    failNextTournamentRead: apiMocks.failNextTournamentRead,
    deferNextRegistrationRead: apiMocks.deferNextHomeCarouselRegistrationRead,
    releaseRegistrationRead: apiMocks.releaseHomeCarouselRegistrationRead,
    mergeHomeTournamentItems,
  };
  root.render(React.createElement(Home));
});