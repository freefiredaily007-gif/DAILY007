import React from "react";
import { createRoot } from "react-dom/client";

globalThis.global ??= globalThis;

const localAsset = () => ({ uri: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
globalThis.require = localAsset;
window.require = localAsset;
globalThis.__previewNavigations = [];

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Home carousel preview root is missing.");

const root = createRoot(rootElement);
const realSetInterval = globalThis.setInterval.bind(globalThis);
const realClearInterval = globalThis.clearInterval.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
const homePollIntervals = [];
const carouselAutoAdvanceIntervals = [];
const screenReaderListeners = new Set();
const accessibilityAnnouncements = [];
let fakeScreenReaderEnabled = false;
const previewParams = new URLSearchParams(window.location.search);
const dateSurfacePreview = previewParams.get("ist-date-surfaces") === "1";
const dateSurfacePhase = previewParams.get("ist-date-phase") ?? "before";
const requestedScreen = previewParams.get("screen") ?? "Home";
const scheduledStartMs = dateSurfacePreview
  ? Date.parse("2029-12-31T18:45:00.000Z")
  : Math.ceil((Date.now() + 5 * 60 * 1000) / 60_000) * 60_000;
let fakeNow = scheduledStartMs + (dateSurfacePreview && dateSurfacePhase === "after" ? 60_000 : -60_000);
let startTimerFired = false;
let scheduledStartTimerCallback = null;
let scheduledStartTimerHandle = null;
let appVisibility = "visible";
Date.now = () => fakeNow;
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => appVisibility,
});

const setAppVisibility = (state) => {
  appVisibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

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
    scheduledStartTimerCallback = () => {
      fakeNow = scheduledStartMs + 20;
      startTimerFired = true;
      callback(...args);
    };
    scheduledStartTimerHandle = realSetTimeout(() => {}, 60_000);
    return scheduledStartTimerHandle;
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
  if (dateSurfacePreview && requestedScreen !== "Home") {
    if (requestedScreen !== "MyMatches" && requestedScreen !== "TDetail") {
      throw new Error(`Unsupported IST date preview screen: ${requestedScreen}`);
    }
    apiMocks.configureIstDateSurfacePreview();
    globalThis.__previewRouteParams = { id: "ist-date-boundary" };
    window.__daily007IstDateSurfacePreview = {
      ready: false,
      screen: requestedScreen,
      tournamentId: "ist-date-boundary",
    };
    const screenModule = requestedScreen === "MyMatches"
      ? await import("../../../daily007/src/screens/MyMatches")
      : await import("../../../daily007/src/screens/TDetail");
    window.__daily007IstDateSurfacePreview.ready = true;
    root.render(React.createElement(screenModule.default));
    return;
  }

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

  const { AccessibilityInfo } = await import("react-native");
  AccessibilityInfo.isScreenReaderEnabled = () => Promise.resolve(fakeScreenReaderEnabled);
  AccessibilityInfo.addEventListener = (eventName, listener) => {
    if (eventName !== "screenReaderChanged") return { remove() {} };
    screenReaderListeners.add(listener);
    return { remove: () => screenReaderListeners.delete(listener) };
  };
  AccessibilityInfo.announceForAccessibility = (announcement) => {
    accessibilityAnnouncements.push(announcement);
  };

  const [{ default: Home, mergeHomeTournamentItems }, { HOME_TOURNAMENT_REFRESH_INTERVAL_MS }] =
    await Promise.all([
      import("../../../daily007/src/screens/Home"),
      import("../../../daily007/src/lib/tournamentLifecycle"),
    ]);
  globalThis.setInterval = (callback, intervalMs, ...args) => {
    if (intervalMs === HOME_TOURNAMENT_REFRESH_INTERVAL_MS) {
      homePollIntervals.push({ callback, intervalMs });
    }
    if (intervalMs === 3500) {
      const interval = {
        callback: () => callback(...args),
        intervalMs,
        active: true,
      };
      carouselAutoAdvanceIntervals.push(interval);
      return interval;
    }
    return realSetInterval(callback, intervalMs, ...args);
  };
  globalThis.clearInterval = (handle) => {
    const carouselInterval = carouselAutoAdvanceIntervals.find((interval) => interval === handle);
    if (carouselInterval) {
      carouselInterval.active = false;
      return;
    }
    realClearInterval(handle);
  };
  window.__daily007HomeCarouselTest = {
    ready: true,
    scheduledStartMs,
    getFakeNow: () => fakeNow,
    didStartTimerFire: () => startTimerFired,
    getHomePollCount: () => homePollIntervals.length,
    getHomePollIntervalMs: () => homePollIntervals[0]?.intervalMs ?? null,
    getCarouselAutoAdvanceIntervalMs: () =>
      [...carouselAutoAdvanceIntervals].reverse().find((interval) => interval.active)?.intervalMs ?? null,
    advanceCarousel: () => {
      const interval = [...carouselAutoAdvanceIntervals].reverse().find((item) => item.active);
      if (!interval) return false;
      interval.callback();
      return true;
    },
    setScreenReaderEnabled: (enabled) => {
      fakeScreenReaderEnabled = enabled;
      for (const listener of screenReaderListeners) listener(enabled);
    },
    getScreenReaderEnabled: () => fakeScreenReaderEnabled,
    getScreenReaderListenerCount: () => screenReaderListeners.size,
    getAccessibilityAnnouncements: () => [...accessibilityAnnouncements],
    clearAccessibilityAnnouncements: () => accessibilityAnnouncements.splice(0),
    hasScheduledStartTimer: () => typeof scheduledStartTimerCallback === "function",
    advancePastScheduledStart: () => {
      if (!scheduledStartTimerCallback) return false;
      const callback = scheduledStartTimerCallback;
      scheduledStartTimerCallback = null;
      if (scheduledStartTimerHandle !== null) {
        realClearTimeout(scheduledStartTimerHandle);
        scheduledStartTimerHandle = null;
      }
      callback();
      return true;
    },
    fireHomePoll: () => {
      const homePoll = homePollIntervals[homePollIntervals.length - 1];
      if (!homePoll) return false;
      homePoll.callback();
      return true;
    },
    getTournamentReadCount: apiMocks.getTournamentReadCount,
    getMyRegistrationReadCount: apiMocks.getMyRegistrationReadCount,
    setRegistrations: apiMocks.setHomeCarouselRegistrationPreview,
    setNextRegistrationResponse: apiMocks.setNextMyRegistrationReadResponse,
    failNextTournamentRead: apiMocks.failNextTournamentRead,
    failNextRegistrationRead: apiMocks.failNextHomeCarouselRegistrationRead,
    deferNextRegistrationRead: apiMocks.deferNextHomeCarouselRegistrationRead,
    releaseRegistrationRead: apiMocks.releaseHomeCarouselRegistrationRead,
    leaveHome: () => root.render(null),
    returnHome: () => root.render(React.createElement(Home)),
    mergeHomeTournamentItems,
    setAppVisibility,
    updateTournament: (id, updates) => {
      const match = apiMocks.previewTournaments.find((tournament) => String(tournament.id) === String(id));
      if (!match) return false;
      Object.assign(match, updates);
      return true;
    },
  };
  root.render(React.createElement(Home));
});