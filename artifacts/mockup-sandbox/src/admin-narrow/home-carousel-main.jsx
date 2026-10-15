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
const adminTournamentHomeRefreshPreview = previewParams.get("admin-tournament-home-refresh") === "1";
const dateSurfacePreview = previewParams.get("ist-date-surfaces") === "1";
const longHomeCardNamesPreview = previewParams.get("long-names") === "1";
const singleHomeCardPreview = previewParams.get("single-card") === "1";
const homeStartSelectionPreview = previewParams.get("home-start-selection") === "1";
const homeInitialRetryScenario = previewParams.get("home-initial-retry");
const dateSurfacePhase = previewParams.get("ist-date-phase") ?? "before";
const dateSurfaceScenario = previewParams.get("ist-date-scenario") ?? "new-year";
const requestedScreen = previewParams.get("screen") ?? "Home";
const dateSurfaceDateOnly = dateSurfaceScenario === "date-only";
const dateSurfaceDate = dateSurfaceScenario === "positive-offset" ? "2029-12-31" : "2030-01-01";
const dateSurfaceStartAt = dateSurfaceScenario === "positive-offset"
  ? "2029-12-31T17:00:00.000Z"
  : dateSurfaceDateOnly
    ? new Date(`${dateSurfaceDate}T00:00:00`).toISOString()
    : "2029-12-31T18:45:00.000Z";
const dateSurfaceTime = dateSurfaceDateOnly ? "12:15 AM" : null;
const scheduledStartMs = dateSurfacePreview
  ? Date.parse(dateSurfaceStartAt)
  : Math.ceil((Date.now() + 5 * 60 * 1000) / 60_000) * 60_000;
let fakeNow = scheduledStartMs + (dateSurfacePreview && dateSurfacePhase === "after" ? 60_000 : -60_000);
let startTimerFired = false;
let scheduledStartTimerCallback = null;
let scheduledStartTimerHandle = null;
let scheduledStartTimerTarget = null;
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
const previewStartTargets = [
  scheduledStartMs,
  scheduledStartMs + 60 * 60 * 1000,
  scheduledStartMs + 2 * 60 * 60 * 1000,
];
globalThis.setTimeout = (callback, delay, ...args) => {
  const matchingStartTarget = typeof callback === "function"
    ? previewStartTargets.find((target) =>
        target > fakeNow && Math.abs(Number(delay) - (target - fakeNow + 20)) <= 5,
      )
    : undefined;
  if (
    matchingStartTarget !== undefined &&
    (homeStartSelectionPreview || (
      shouldAccelerateStartTimer &&
      Math.abs(Number(delay) - expectedStartTimerDelay) <= 5
    ))
  ) {
    shouldAccelerateStartTimer = false;
    scheduledStartTimerTarget = matchingStartTarget;
    scheduledStartTimerCallback = () => {
      fakeNow = matchingStartTarget + 20;
      startTimerFired = true;
      callback(...args);
    };
    scheduledStartTimerHandle = realSetTimeout(() => {}, 60_000);
    return scheduledStartTimerHandle;
  }
  return realSetTimeout(callback, delay, ...args);
};
globalThis.clearTimeout = (handle) => {
  if (homeStartSelectionPreview && handle === scheduledStartTimerHandle) {
    scheduledStartTimerCallback = null;
    scheduledStartTimerTarget = null;
    scheduledStartTimerHandle = null;
  }
  realClearTimeout(handle);
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
    const shiftedStart = new Date(scheduledStartMs + 5.5 * 60 * 60 * 1000);
    const previewSchedule = {
      date: dateSurfaceDateOnly ? dateSurfaceDate : shiftedStart.toISOString().slice(0, 10),
      time: dateSurfaceTime ?? istTime(scheduledStartMs),
      ...(dateSurfaceDateOnly ? {} : { startsAt: asIstTimestamp(scheduledStartMs) }),
    };
    const configuredSchedule = apiMocks.configureIstDateSurfacePreview(previewSchedule);
    globalThis.__previewRouteParams = { id: "ist-date-boundary" };
    window.__daily007IstDateSurfacePreview = {
      ready: false,
      screen: requestedScreen,
      tournamentId: "ist-date-boundary",
      hasStartsAt: Object.prototype.hasOwnProperty.call(configuredSchedule, "startsAt"),
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
    mode: id === "starting-soon" && longHomeCardNamesPreview
      ? "Clash Squad"
      : id === "later-two" && longHomeCardNamesPreview
        ? "Custom"
        : "Battle Royale",
    teamType: "Solo",
    gameMode: id === "starting-soon" && longHomeCardNamesPreview
      ? "clash_squad"
      : id === "later-two" && longHomeCardNamesPreview
        ? "custom"
        : "battle_royale",
    date: dateSurfaceDateOnly ? dateSurfaceDate : asIstTimestamp(startsAt).slice(0, 10),
    time: dateSurfaceTime ?? istTime(startsAt),
    ...(dateSurfaceDateOnly ? {} : { startsAt: asIstTimestamp(startsAt) }),
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
  const homeTournaments = [
    tournament(
      "starting-soon",
      longHomeCardNamesPreview
        ? "Daily007 Grand Championship: Clash Squad Finals for the International Winter Festival"
        : "Starting at IST",
      scheduledStartMs + (homeStartSelectionPreview ? 2 * 60 * 60 * 1000 : 0),
    ),
    tournament(
      "later-one",
      longHomeCardNamesPreview
        ? "Daily007 International Champions Cup: Battle Royale Solo Qualifier Round"
        : "Later Tournament One",
      scheduledStartMs + (homeStartSelectionPreview ? 0 : 60 * 60 * 1000),
    ),
    tournament(
      "later-two",
      longHomeCardNamesPreview
        ? "Daily007 Weekend Custom Showdown: Team Challenge for the Global Player Championship"
        : "Later Tournament Two",
      scheduledStartMs + (homeStartSelectionPreview ? 60 * 60 * 1000 : 2 * 60 * 60 * 1000),
    ),
  ];
  apiMocks.previewTournaments.splice(
    0,
    apiMocks.previewTournaments.length,
    ...(singleHomeCardPreview ? homeTournaments.slice(0, 1) : homeTournaments),
  );
  if (homeInitialRetryScenario === "registration-empty") {
    apiMocks.previewTournaments.splice(0, apiMocks.previewTournaments.length);
  }
  apiMocks.configureHomeCarouselRegistrationPreview();
  if (homeInitialRetryScenario === "tournament") {
    apiMocks.failNextTournamentRead("Initial Home tournament request failed.");
  } else if (homeInitialRetryScenario === "registration-empty") {
    apiMocks.failNextHomeCarouselRegistrationRead("Initial Home registration request failed.");
  } else if (homeInitialRetryScenario) {
    throw new Error(`Unsupported Home initial retry scenario: ${homeInitialRetryScenario}`);
  }

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

  const [homeModule, lifecycleModule] = await Promise.all([
    import("../../../daily007/src/screens/Home"),
    import("../../../daily007/src/lib/tournamentLifecycle"),
  ]);
  const { default: Home, mergeHomeTournamentItems } = homeModule;
  const { HOME_TOURNAMENT_REFRESH_INTERVAL_MS } = lifecycleModule;
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
    getScheduledStartTimerTarget: () => scheduledStartTimerTarget,
    advancePastScheduledStart: () => {
      if (!scheduledStartTimerCallback) return false;
      const callback = scheduledStartTimerCallback;
      scheduledStartTimerCallback = null;
      scheduledStartTimerTarget = null;
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
    getPublicEnabledTournamentIds: async () =>
      (await apiMocks.Api.tournaments("?enabled=true")).map((tournament) => String(tournament.id)),
    closeTournamentAsAdmin: (id) => apiMocks.Api.deleteTournament(id),
    getTournamentStartFieldPresence: () =>
      apiMocks.previewTournaments.map((tournament) => Object.prototype.hasOwnProperty.call(tournament, "startsAt")),
    setRegistrations: apiMocks.setHomeCarouselRegistrationPreview,
    publishAdminCreatedTournament: () => {
      if (!adminTournamentHomeRefreshPreview) return false;
      const serialized = window.sessionStorage.getItem(
        "daily007-admin-created-tournament-home-refresh",
      );
      if (!serialized) return false;
      const tournament = JSON.parse(serialized);
      const existing = apiMocks.previewTournaments.find(
        (item) => String(item.id) === String(tournament.id),
      );
      if (!existing) apiMocks.previewTournaments.push(tournament);
      return String(tournament.id);
    },
    setNextRegistrationResponse: apiMocks.setNextMyRegistrationReadResponse,
    failNextTournamentRead: apiMocks.failNextTournamentRead,
    failNextRegistrationRead: apiMocks.failNextHomeCarouselRegistrationRead,
    deferNextRegistrationRead: apiMocks.deferNextHomeCarouselRegistrationRead,
    releaseRegistrationRead: apiMocks.releaseHomeCarouselRegistrationRead,
    setTournamentOrder: (ids) => {
      if (!Array.isArray(ids) || ids.length !== apiMocks.previewTournaments.length) return false;
      const tournamentsById = new Map(
        apiMocks.previewTournaments.map((tournament) => [String(tournament.id), tournament]),
      );
      const orderedTournaments = ids.map((id) => tournamentsById.get(String(id)));
      if (
        orderedTournaments.some((tournament) => !tournament) ||
        new Set(ids.map(String)).size !== apiMocks.previewTournaments.length
      ) {
        return false;
      }
      apiMocks.previewTournaments.splice(
        0,
        apiMocks.previewTournaments.length,
        ...orderedTournaments,
      );
      return true;
    },
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