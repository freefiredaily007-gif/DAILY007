import React from "react";
import { createRoot } from "react-dom/client";

const localAsset = () => ({ uri: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
globalThis.require = localAsset;
window.require = localAsset;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Tournament resume preview root is missing.");

const root = createRoot(rootElement);
let rememberedFocus = null;
const loadAnnouncementEvents = [];
const captureLoadAnnouncement = (region) => {
  const testID = region.getAttribute("data-testid")
    ?? region.closest("[data-testid]")?.getAttribute("data-testid");
  if (!["player-tournament-load-error", "player-tournament-load-announcement"].includes(testID)) {
    return;
  }
  const text = region.getAttribute("aria-label") ?? region.textContent?.trim() ?? "";
  const previous = loadAnnouncementEvents.at(-1);
  if (previous?.testID === testID && previous.text === text) return;
  loadAnnouncementEvents.push({ testID, text });
};
const inspectLoadAnnouncementNode = (node) => {
  if (!(node instanceof Element)) return;
  if (node.matches('[aria-live="polite"]')) captureLoadAnnouncement(node);
  node.querySelectorAll('[aria-live="polite"]').forEach(captureLoadAnnouncement);
};
const loadAnnouncementObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    const target = mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement;
    if (target) inspectLoadAnnouncementNode(target);
    mutation.addedNodes.forEach(inspectLoadAnnouncementNode);
  }
});
loadAnnouncementObserver.observe(rootElement, {
  subtree: true,
  childList: true,
  characterData: true,
});
const scheduledStartOnly = new URLSearchParams(location.search).has("scheduled-start-only");
const initialLoadFailureOnly = new URLSearchParams(location.search).has("initial-load-failure-only");
const registrationInitialLoadFailureOnly = new URLSearchParams(location.search).has("registration-initial-load-failure-only");
const adminInitialLoadFailureOnly = new URLSearchParams(location.search).has("admin-initial-load-failure-only");
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const scheduledStartGapMs = 3_000;
const boundaryCase = new URLSearchParams(location.search).get("boundary") || "month-end";
const fixedBoundaryStarts = {
  "month-end": {
    name: "IST Month-End Boundary",
    laterName: "Later Month-End Start",
    startsAt: "2026-05-01T00:00:01+05:30",
  },
  "new-year": {
    name: "IST New Year Boundary",
    laterName: "Later New Year Start",
    startsAt: "2027-01-01T00:00:01+05:30",
  },
};
const selectedBoundary = fixedBoundaryStarts[boundaryCase];
if (!selectedBoundary) throw new Error(`Unsupported scheduled-start boundary: ${boundaryCase}`);
const firstScheduledTournamentName = scheduledStartOnly ? selectedBoundary.name : "IST Start Boundary";
const laterScheduledTournamentName = scheduledStartOnly
  ? selectedBoundary.laterName
  : "Later IST Tournament Boundary";
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
  ? Date.parse(selectedBoundary.startsAt)
  : Date.now() + 10 * 60 * 1000;
let laterScheduledStartMs = scheduledStartOnly
  ? scheduledStartMs + scheduledStartGapMs
  : scheduledStartMs + scheduledStartGapMs;
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
    scheduledTournament("resume-boundary", firstScheduledTournamentName, scheduledStartMs),
  ];
  if (scheduledStartOnly) {
    scheduledTournaments.push(
      scheduledTournament("resume-boundary-later", laterScheduledTournamentName, laterScheduledStartMs),
    );
  }
  apiMocks.previewTournaments.splice(0, apiMocks.previewTournaments.length, ...scheduledTournaments);
  if (registrationInitialLoadFailureOnly) {
    apiMocks.configureMyRegistrationPreview([
      {
        id: "preview-registration-recovered",
        tournamentId: "resume-boundary",
        status: "approved",
      },
    ]);
    apiMocks.failNextMyRegistrationRead("Initial registration request failed");
  }
  if (initialLoadFailureOnly || adminInitialLoadFailureOnly) {
    apiMocks.failNextTournamentRead(
      adminInitialLoadFailureOnly
        ? "Initial Admin tournament request failed"
        : "Initial tournament request failed",
    );
  }

  const [
    { default: Tournaments },
    { default: AdminTournaments },
    { AdminUiProvider },
  ] = await Promise.all([
    import("../../../daily007/src/screens/Tournaments"),
    import("../../../daily007/src/screens/AdminTournaments"),
    import("../../../daily007/src/components/ui"),
  ]);
  const renderAdmin = () => root.render(
    React.createElement(
      AdminUiProvider,
      null,
      React.createElement(AdminTournaments),
    ),
  );

  const setVisibility = (state) => {
    visibilityState = state;
    document.dispatchEvent(new Event("visibilitychange"));
  };

  window.__daily007TournamentResume = {
    ready: true,
    getTournamentReadCount: apiMocks.getTournamentReadCount,
    getMyRegistrationReadCount: apiMocks.getMyRegistrationReadCount,
    getLoadAnnouncementEvents: () => loadAnnouncementEvents.map((event) => ({ ...event })),
    resetTournamentReadCount: apiMocks.resetTournamentReadCount,
    getVisibleText: () => {
      const text = document.body.innerText || '';
      const announcement = document
        .querySelector('[data-testid="tournament-start-announcement"]')
        ?.textContent?.trim();
      return announcement ? text.replace(announcement, '') : text;
    },
    failNextTournamentRead: apiMocks.failNextTournamentRead,
    deferNextTournamentRead: apiMocks.deferNextTournamentRead,
    failDeferredTournamentRead: apiMocks.failDeferredTournamentRead,
    getVisibilityChangeCount: () => visibilityChangeCount,
    getVisibilityState: () => visibilityState,
    updateTournament: (updates) => Object.assign(apiMocks.previewTournaments[0], updates),
    getScheduledStartInfo: () => {
      const istBeforeStart = new Date(fakeNow + IST_OFFSET_MS).toISOString();
      return {
        browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        nowMs: fakeNow,
        beforeIstDate: istBeforeStart.slice(0, 10),
        beforeIstTime: istBeforeStart.slice(11, 19),
        schedules: apiMocks.previewTournaments.slice(0, scheduledStartOnly ? 2 : 1).map((tournament, index) => {
          const startMs = index === 0 ? scheduledStartMs : laterScheduledStartMs;
          const istStart = new Date(startMs + IST_OFFSET_MS).toISOString();
          const istDate = new Date(startMs + IST_OFFSET_MS);
          return {
            name: tournament.name,
            startsAt: tournament.startsAt,
            date: tournament.date,
            time: tournament.time,
            startMs,
            istDate: istStart.slice(0, 10),
            istDateLabel: `${String(istDate.getUTCDate()).padStart(2, "0")} ${istDate.toLocaleString("en", {
              month: "short",
              timeZone: "UTC",
            }).toUpperCase()}`,
            istTime: istStart.slice(11, 19),
            utcDate: new Date(startMs).toISOString().slice(0, 10),
          };
        }),
      };
    },
    advanceClockPastFirstStart: () => { fakeNow = scheduledStartMs + 100; },
    setClockBeforeSecondStart: () => { fakeNow = laterScheduledStartMs - 2_000; },
    advanceClockPastSecondStart: () => { fakeNow = laterScheduledStartMs + 100; },
    resumeCurrentList: () => {
      setVisibility("hidden");
      setVisibility("visible");
    },
    rememberFocus: () => { rememberedFocus = document.activeElement; },
    focusUpcomingTabAndRemember: () => {
      const tab = document.querySelector('[data-testid="tournament-tab-upcoming"]');
      if (!(tab instanceof HTMLElement)) return false;
      tab.focus();
      rememberedFocus = document.activeElement;
      return rememberedFocus === tab;
    },
    focusUnchanged: () => document.activeElement === rememberedFocus,
    prepareAdminForScheduledStart: () => {
      fakeNow = scheduledStartMs - 2_000;
      Object.assign(
        apiMocks.previewTournaments[0],
        scheduledTournament("resume-boundary", firstScheduledTournamentName, scheduledStartMs),
      );
      if (scheduledStartOnly) {
        Object.assign(
          apiMocks.previewTournaments[1],
          scheduledTournament(
            "resume-boundary-later",
            laterScheduledTournamentName,
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
    showAdmin: renderAdmin,
  };

  if (adminInitialLoadFailureOnly) renderAdmin();
  else root.render(React.createElement(Tournaments));
});