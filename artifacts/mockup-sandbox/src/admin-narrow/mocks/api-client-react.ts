import { useCallback, useRef, useState } from "react";

const resultLogs = [
  {
    tournamentId: "preview-completed",
    registrationId: "preview-result-1",
    rank: 1,
    kills: 8,
    prizeCoins: 300,
    gameName: "Preview Champion",
    playerName: "Preview Player",
    teamName: "",
  },
  {
    tournamentId: "preview-completed",
    registrationId: "preview-result-2",
    rank: 2,
    kills: 5,
    prizeCoins: 0,
    gameName: "Preview Runner-up",
    playerName: "Preview Player Two",
    teamName: "",
  },
];

const noMutation = () => ({
  isPending: false,
  mutate: () => undefined,
  mutateAsync: async () => ({}),
});

const noQuery = <T,>(data: T) => ({
  data,
  error: null,
  isError: false,
  isLoading: false,
  isPending: false,
  isRefetching: false,
  refetch: async () => ({ data }),
});

const leaderboardPeriod = (cycleType: "weekly" | "monthly") => ({
  cycleType,
  status: "active" as const,
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-10-08T00:00:00.000Z",
  standings: Array.from({ length: 20 }, (_, index) => {
    const rank = index + 1;
    const name = rank === 1
      ? `${cycleType === "weekly" ? "Weekly" : "Monthly"} Champion With A Long Display Name`
      : rank === 4
        ? "International Tournament Competitor With A Player Name That Wraps Across Multiple Lines"
        : rank === 20
          ? "Rank Twenty Final Player"
          : `Tournament Competitor ${rank}`;
    return {
      rank,
      userId: `largest-text-${cycleType}-${rank}`,
      name,
      points: rank === 20 ? 1_234_567 : 20_000 - rank * 731,
      earnings: 0,
      wins: 0,
      kills: 0,
      matches: 0,
    };
  }),
  rewards: [
    { rank: 1, coins: 5000 },
    { rank: 2, coins: 2500 },
    { rank: 3, coins: 1000 },
  ],
});

export const getDaily007ListLeaderboardsQueryKey = () => ["isolated-preview", "leaderboards"];

export function useDaily007ListLeaderboards() {
  return noQuery({
    weekly: leaderboardPeriod("weekly"),
    monthly: leaderboardPeriod("monthly"),
  });
}

const largestTextReferrals = {
  code: "D7MAX",
  referralLink: "https://daily007.example.invalid/signup?ref=D7MAX&source=invite",
  totalPeopleReferred: 123456,
  successfulReferrals: 12345,
  pendingReferrals: 2345,
  totalReferralCoinsEarned: 987654,
  referrals: [
    {
      id: "largest-text-referral",
      referredName: "International Tournament Player With A Long Name",
      referredUserId: "daily007-user-12345678901234567890",
      referrerRewardStatus: "credited",
      firstRechargeStatus: "awaiting_approval",
      signupStatus: "complete",
      signupBonusStatus: "credited",
      qualifyingPaymentId: "UPI-RECHARGE-REFERENCE-12345678901234567890",
    },
  ],
};

const largestTextVideos = [
  {
    id: "large-video-01",
    title: "How to Join the Daily007 International Free Fire Championship",
    topic: "Tournament registration and complete player account setup",
    youtubeId: "preview-video-01",
    url: "https://www.youtube.com/watch?v=preview-video-01",
  },
  {
    id: "large-video-02",
    title: "How to Claim Your Approved Tournament Prize Coins",
    topic: "Wallet balance, match results, and prize history",
    youtubeId: "preview-video-02",
    url: "https://www.youtube.com/watch?v=preview-video-02",
  },
];

const adminLargeTextVideos = [
  {
    id: "preview-admin-video-active-international-guide",
    title: "Daily007 Guide: Joining the International Free Fire Championship",
    topic: "Tournament registration, approved player rosters, and room details",
    youtubeId: "preview-admin-video-active",
    url: "https://youtu.be/D7JoinGuide",
    active: true,
    createdAt: "2026-09-18T09:30:00.000Z",
  },
  {
    id: "preview-admin-video-hidden-prize-guide",
    title: "How to Review Match Results and Claim Your Championship Prize",
    topic: "Match placements, wallet history, and tournament reward questions",
    youtubeId: "preview-admin-video-hidden",
    url: "https://youtu.be/D7PrizeHelp",
    active: false,
    createdAt: "2026-09-12T14:15:00.000Z",
  },
];

const adminLargeTextYoutubeClaims = [
  {
    id: "preview-admin-youtube-claim-ananya-2026",
    userName: "Ananya Daily007 Championship Champion With A Long Name",
    email: "ananya.champion.with.a.long.fake.address@example.invalid",
    userId: "preview-user-ananya-championship-2026",
    rewardCoins: 2500,
    status: "pending",
    createdAt: "2026-10-06T14:35:00.000Z",
    reviewedAt: null,
    reviewReason: null,
    transactionId: null,
  },
  {
    id: "preview-admin-youtube-claim-rohan-2026",
    userName: "Rohan Free Fire Strategist and National Tournament Finalist",
    email: "rohan.international.tournament.preview.player@example.invalid",
    userId: "preview-user-rohan-free-fire-2026",
    rewardCoins: 1500,
    status: "pending",
    createdAt: "2026-10-05T08:20:00.000Z",
    reviewedAt: null,
    reviewReason: null,
    transactionId: null,
  },
];

const rewardPreviewVideos = [
  {
    id: "unavailable-video",
    title: "Preview video that becomes unavailable",
    topic: "Unavailable reward regression",
    youtubeId: "preview-unavailable-video",
    url: "https://www.youtube.com/watch?v=preview-unavailable-video",
  },
  {
    id: "still-active-video",
    title: "Preview video that remains available",
    topic: "Catalog refresh regression",
    youtubeId: "preview-active-video",
    url: "https://www.youtube.com/watch?v=preview-active-video",
  },
];
const delayedStartAcrossVideosPreviewVideos = [
  {
    id: "delayed-start-video-a",
    title: "Delayed Start Preview Video A",
    topic: "Pending session race",
    youtubeId: "preview-delayed-start-a",
    url: "https://www.youtube.com/watch?v=preview-delayed-start-a",
    active: true,
  },
  {
    id: "delayed-start-video-b",
    title: "Delayed Start Preview Video B",
    topic: "Pending session race",
    youtubeId: "preview-delayed-start-b",
    url: "https://www.youtube.com/watch?v=preview-delayed-start-b",
    active: true,
  },
];
const activeRewardPreviewVideos = rewardPreviewVideos.filter((video) => video.id !== "unavailable-video");
const catalogPositionPreviewVideos = Array.from({ length: 18 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  const isLowerTarget = index === 14;
  const id = isLowerTarget ? "lower-active-video" : `catalog-position-video-${number}`;
  const title = isLowerTarget
    ? "Lower Catalog Recovery Video"
    : `Catalog Position Preview Video ${number}`;
  return {
    id,
    title,
    topic: `Catalog Position Topic ${number}`,
    youtubeId: `catalog-position-preview-${number}`,
    url: `https://www.youtube.com/watch?v=catalog-position-preview-${number}`,
    active: true,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
});

type VideoRewardPreviewMode =
  | "unavailable"
  | "unavailableRefreshFailure"
  | "lateCatalogResponse"
  | "catalogPositionRefreshFailure"
  | "catalogRefreshPending"
  | "connectivityRecovery"
  | "transient"
  | "lateCompletion"
  | "startFailure"
  | "delayedStart"
  | "delayedStartAcrossVideos"
  | null;
type VideoRewardPreviewCalls = {
  starts: unknown[];
  sessions: string[];
  completions: unknown[];
  listRefetches: number;
  lateCompletionRejections: number;
  catalogRefetchCancelOptions: boolean[];
  lateCatalogResponsesResolved: number;
};

let videoRewardPreviewMode: VideoRewardPreviewMode = null;
let transientCompletionFailures = 0;
let videoWatchStartFailures = 0;

function getVideoRewardPreviewCalls(): VideoRewardPreviewCalls {
  const preview = globalThis as typeof globalThis & {
    __videoRewardPreviewCalls?: VideoRewardPreviewCalls;
  };
  preview.__videoRewardPreviewCalls ??= {
    starts: [],
    sessions: [],
    completions: [],
    listRefetches: 0,
    lateCompletionRejections: 0,
    catalogRefetchCancelOptions: [],
    lateCatalogResponsesResolved: 0,
  };
  return preview.__videoRewardPreviewCalls;
}

export function configureVideoRewardPreview(mode: VideoRewardPreviewMode) {
  videoRewardPreviewMode = mode;
  transientCompletionFailures = 0;
  videoWatchStartFailures = 0;
  const preview = globalThis as typeof globalThis & {
    __videoRewardPreviewCalls?: VideoRewardPreviewCalls;
    __resolvePendingVideoWatchStart?: () => void;
    __rejectPendingVideoRewardCompletion?: () => void;
    __resolveHeldVideoCatalogRefetch?: () => void;
    __finishHeldVideoCatalogRefetch?: (succeed: boolean) => void;
  };
  preview.__videoRewardPreviewCalls = {
    starts: [],
    sessions: [],
    completions: [],
    listRefetches: 0,
    lateCompletionRejections: 0,
    catalogRefetchCancelOptions: [],
    lateCatalogResponsesResolved: 0,
  };
  preview.__resolvePendingVideoWatchStart = undefined;
  preview.__rejectPendingVideoRewardCompletion = undefined;
  preview.__resolveHeldVideoCatalogRefetch = undefined;
  preview.__finishHeldVideoCatalogRefetch = undefined;
}

export const getDaily007ListVideosQueryKey = () => ["isolated-preview", "videos"];

export function useDaily007ListVideos() {
  const mode = videoRewardPreviewMode;
  const [refreshCount, setRefreshCount] = useState(0);
  const [refreshFailed, setRefreshFailed] = useState(
    mode === "lateCatalogResponse"
      || mode === "catalogRefreshPending"
      || mode === "connectivityRecovery",
  );
  const refreshFailureCount = useRef(0);
  const lateCatalogRequestSequenceRef = useRef(0);
  const removesUnavailable = mode === "unavailable"
    || mode === "unavailableRefreshFailure"
    || mode === "lateCatalogResponse"
    || mode === "connectivityRecovery";
  const previewVideos = mode === "catalogPositionRefreshFailure"
    ? catalogPositionPreviewVideos
    : mode === "delayedStartAcrossVideos"
      ? delayedStartAcrossVideosPreviewVideos
      : rewardPreviewVideos;
  const videos = mode
    ? removesUnavailable && refreshCount > 0
      ? activeRewardPreviewVideos
      : previewVideos
    : largestTextVideos;
  const refetch = useCallback(async (options?: { cancelRefetch?: boolean }) => {
    const calls = getVideoRewardPreviewCalls();
    calls.listRefetches += 1;
    calls.catalogRefetchCancelOptions.push(options?.cancelRefetch ?? false);
    if (mode === "catalogRefreshPending") {
      if (options?.cancelRefetch !== true) {
        return { error: new Error("Temporary video catalog refresh failure.") };
      }
      return new Promise((resolve) => {
        const preview = globalThis as typeof globalThis & {
          __finishHeldVideoCatalogRefetch?: (succeed: boolean) => void;
        };
        preview.__finishHeldVideoCatalogRefetch = (succeed) => {
          preview.__finishHeldVideoCatalogRefetch = undefined;
          if (succeed) {
            setRefreshFailed(false);
            setRefreshCount((current) => current + 1);
            resolve({ data: { videos: activeRewardPreviewVideos } });
          } else {
            setRefreshFailed(true);
            resolve({ error: new Error("Temporary video catalog refresh failure.") });
          }
        };
      });
    }
    if (mode === "lateCatalogResponse") {
      if (options?.cancelRefetch !== true) {
        return { error: new Error("Temporary video catalog refresh failure.") };
      }

      const requestSequence = ++lateCatalogRequestSequenceRef.current;
      if (requestSequence === 1) {
        return new Promise<{ data: { videos: typeof rewardPreviewVideos } }>((resolve) => {
          const preview = globalThis as typeof globalThis & {
            __resolveHeldVideoCatalogRefetch?: () => void;
          };
          preview.__resolveHeldVideoCatalogRefetch = () => {
            preview.__resolveHeldVideoCatalogRefetch = undefined;
            if (requestSequence === lateCatalogRequestSequenceRef.current) {
              setRefreshFailed(false);
              setRefreshCount((current) => current + 1);
            }
            calls.lateCatalogResponsesResolved += 1;
            resolve({ data: { videos: rewardPreviewVideos } });
          };
        });
      }

      setRefreshFailed(false);
      setRefreshCount((current) => current + 1);
      return { data: { videos: activeRewardPreviewVideos } };
    }
    if (mode === "connectivityRecovery" && calls.listRefetches <= 2) {
      setRefreshFailed(true);
      return { error: new Error("Temporary video catalog refresh failure.") };
    }
    if (mode === "catalogPositionRefreshFailure") {
      if (options?.cancelRefetch === true) {
        if (refreshFailureCount.current < 2) {
          refreshFailureCount.current += 1;
          setRefreshFailed(true);
          return { error: new Error("Temporary video catalog refresh failure.") };
        }
        setRefreshFailed(false);
        setRefreshCount((current) => current + 1);
        return { data: { videos: catalogPositionPreviewVideos } };
      }
      if (calls.listRefetches === 1) {
        return { data: { videos: catalogPositionPreviewVideos } };
      }
      refreshFailureCount.current = Math.max(refreshFailureCount.current, 1);
      setRefreshFailed(true);
      return { error: new Error("Temporary video catalog refresh failure.") };
    }
    if (mode === "unavailableRefreshFailure" && calls.completions.length === 0) {
      return { data: { videos: rewardPreviewVideos } };
    }
    if (mode === "unavailableRefreshFailure" && refreshFailureCount.current < 2) {
      refreshFailureCount.current += 1;
      setRefreshFailed(true);
      return { error: new Error("Temporary video catalog refresh failure.") };
    }
    setRefreshFailed(false);
    setRefreshCount((current) => current + 1);
    return {
      data: {
        videos: removesUnavailable
          ? activeRewardPreviewVideos
          : rewardPreviewVideos,
      },
    };
  }, [mode, removesUnavailable]);

  if (mode) {
    return {
      ...noQuery({ videos }),
      isError: refreshFailed,
      error: refreshFailed ? new Error("Temporary video catalog refresh failure.") : null,
      refetch,
    };
  }
  return noQuery({ videos: largestTextVideos });
}

export function useDaily007StartVideoWatch() {
  if (videoRewardPreviewMode) {
    return {
      ...noMutation(),
      mutateAsync: async (input: unknown) => {
        const calls = getVideoRewardPreviewCalls();
        calls.starts.push(input);
        if (videoRewardPreviewMode === "startFailure" && videoWatchStartFailures === 0) {
          videoWatchStartFailures += 1;
          throw new Error("The video watch session could not be created.");
        }
        const sessionId = `preview-video-watch-session-${calls.starts.length}`;
        const shouldHoldStart =
          ((videoRewardPreviewMode === "delayedStart"
            || videoRewardPreviewMode === "delayedStartAcrossVideos")
            && calls.starts.length === 1)
          || (videoRewardPreviewMode === "startFailure"
            && videoWatchStartFailures === 1
            && calls.starts.length === 2);
        if (shouldHoldStart) {
          await new Promise<void>((resolve) => {
            const preview = globalThis as typeof globalThis & {
              __resolvePendingVideoWatchStart?: () => void;
            };
            preview.__resolvePendingVideoWatchStart = () => {
              preview.__resolvePendingVideoWatchStart = undefined;
              calls.sessions.push(sessionId);
              resolve();
            };
          });
        } else {
          calls.sessions.push(sessionId);
        }
        return { sessionId };
      },
    };
  }
  return noMutation();
}

export function useDaily007CompleteVideoWatch() {
  const mode = videoRewardPreviewMode;
  if (mode) {
    return {
      ...noMutation(),
      mutateAsync: async (input: unknown) => {
        const calls = getVideoRewardPreviewCalls();
        calls.completions.push(input);
        if (mode === "unavailable" || mode === "unavailableRefreshFailure") {
          const error = new Error("Request failed with status code 409") as Error & {
            response?: { data?: { error?: string } };
          };
          error.response = {
            data: { error: "This video is no longer available for rewards." },
          };
          throw error;
        }
        if (mode === "lateCompletion" && calls.completions.length === 1) {
          return await new Promise<never>((_resolve, reject) => {
            const preview = globalThis as typeof globalThis & {
              __rejectPendingVideoRewardCompletion?: () => void;
            };
            preview.__rejectPendingVideoRewardCompletion = () => {
              preview.__rejectPendingVideoRewardCompletion = undefined;
              calls.lateCompletionRejections += 1;
              reject(new Error("Late completion failed for the previous video."));
            };
          });
        }
        if (mode === "lateCompletion" && calls.completions.length === 2) {
          throw new Error("Temporary current-video completion failure.");
        }
        if (mode === "transient" && transientCompletionFailures === 0) {
          transientCompletionFailures += 1;
          throw new Error("Temporary completion network failure.");
        }
        return { rewarded: true, message: "1 coin added to your wallet." };
      },
    };
  }
  return noMutation();
}

export function useDaily007GetMyReferrals() {
  return noQuery(largestTextReferrals);
}

export function useDaily007GetYoutubeSubscribeTask() {
  return noQuery({
    enabled: true,
    completed: false,
    rewardCoins: 2,
    channelUrl: "https://www.youtube.com/@daily007",
    claim: null,
  });
}

export function useDaily007SubmitYoutubeSubscribeClaim() {
  return noMutation();
}

type PasswordChangePreviewCalls = {
  requests: { currentPassword: string; newPassword: string }[];
};

let passwordChangeConflictRemaining = 0;

function getPasswordChangePreviewCalls(): PasswordChangePreviewCalls {
  const preview = globalThis as typeof globalThis & {
    __daily007PasswordChangePreview?: PasswordChangePreviewCalls;
  };
  preview.__daily007PasswordChangePreview ??= { requests: [] };
  return preview.__daily007PasswordChangePreview;
}

export function configurePasswordChangePreview() {
  passwordChangeConflictRemaining = 1;
  const preview = globalThis as typeof globalThis & {
    __daily007PasswordChangePreview?: PasswordChangePreviewCalls;
  };
  preview.__daily007PasswordChangePreview = { requests: [] };
}

export function useDaily007ChangePassword() {
  return {
    ...noMutation(),
    mutateAsync: async (input: { data: { currentPassword: string; newPassword: string } }) => {
      getPasswordChangePreviewCalls().requests.push({
        currentPassword: input.data.currentPassword,
        newPassword: input.data.newPassword,
      });
      if (passwordChangeConflictRemaining > 0) {
        passwordChangeConflictRemaining -= 1;
        const error = new Error("Request failed with status code 409") as Error & {
          response?: { data?: { error?: string } };
        };
        error.response = {
          data: { error: "The password changed in another session. Sign in again and retry." },
        };
        throw error;
      }
      return { message: "Password changed. Other signed-in sessions remain active." };
    },
  };
}

export const getDaily007ListAdminResultLogsQueryKey = () => [
  "isolated-admin-preview",
  "result-logs",
];

export function useDaily007ListAdminResultLogs() {
  const scale = Number(
    (globalThis as typeof globalThis & { __daily007LargeTextScale?: number })
      .__daily007LargeTextScale,
  );
  const logs = Number.isFinite(scale) && scale > 1
    ? resultLogs.map((entry, index) => index === 0
      ? {
          ...entry,
          gameName: "Daily007 International Free Fire Championship Winner",
          playerName: "International Tournament Champion With A Long Player Name",
          teamName: "Daily007 Grand Finals Championship Squad",
        }
      : entry)
    : resultLogs;
  return noQuery({ data: logs });
}

export function useUpdateTournamentLifecycle() {
  return noMutation();
}

export function useDaily007AdminGetLeaderboardRewards() {
  return noQuery({
    weekly: {
      firstPlaceCoins: 0,
      secondPlaceCoins: 0,
      thirdPlaceCoins: 0,
      currentPeriodStartsAt: null,
      currentPeriodEndsAt: null,
    },
    monthly: {
      firstPlaceCoins: 0,
      secondPlaceCoins: 0,
      thirdPlaceCoins: 0,
      currentPeriodStartsAt: null,
      currentPeriodEndsAt: null,
    },
  });
}

export function useDaily007AdminGetLeaderboardApprovals() {
  return noQuery({ periods: [] });
}

export function useDaily007AdminStartLeaderboardCycle() {
  return noMutation();
}

export function useDaily007AdminApproveLeaderboardPeriod() {
  return noMutation();
}

export function useDaily007AdminUpdateLeaderboardRewards() {
  return noMutation();
}

export function useDaily007AdminListYoutubeSubscribeClaims() {
  const scale = Number(
    (globalThis as typeof globalThis & { __daily007LargeTextScale?: number })
      .__daily007LargeTextScale,
  );
  return noQuery(
    Number.isFinite(scale) && scale > 1
      ? { claims: adminLargeTextYoutubeClaims, totalCompleted: 1234 }
      : { claims: [], totalCompleted: 0 },
  );
}

export function useDaily007AdminReviewYoutubeSubscribeClaim() {
  return noMutation();
}

export function useDaily007AdminListVideos() {
  const scale = Number(
    (globalThis as typeof globalThis & { __daily007LargeTextScale?: number })
      .__daily007LargeTextScale,
  );
  return noQuery({
    videos: Number.isFinite(scale) && scale > 1 ? adminLargeTextVideos : [],
  });
}

export function useDaily007AdminCreateVideo() {
  return noMutation();
}

export function useDaily007AdminDeleteVideo() {
  return noMutation();
}

export function useDaily007AdminSetVideoActive() {
  return noMutation();
}

export function useDaily007AdminUpdateVideo() {
  return noMutation();
}

export function useDaily007AdminDeleteUser() {
  return noMutation();
}

export const getGetTournamentParticipantsQueryKey = (tournamentId: string) =>
  ["preview-tournament-participants", tournamentId] as const;

export const getGetTournamentResultsQueryKey = (tournamentId: string) =>
  ["preview-tournament-results", tournamentId] as const;

const previewTournamentParticipants = { entries: [], total: 0 };
const previewTournamentResults = { status: "pending", entries: [] };
const refetchPreviewTournamentParticipants = async () => ({
  data: previewTournamentParticipants,
  isSuccess: true,
});
const refetchPreviewTournamentResults = async () => ({
  data: previewTournamentResults,
  isSuccess: true,
});

export function useGetTournamentParticipants(_tournamentId: string, _options?: unknown) {
  return {
    ...noQuery(previewTournamentParticipants),
    refetch: refetchPreviewTournamentParticipants,
  };
}

export function useGetTournamentResults(_tournamentId: string, _options?: unknown) {
  return {
    ...noQuery(previewTournamentResults),
    refetch: refetchPreviewTournamentResults,
  };
}

export const getDaily007V2GetSquadSlotsQueryKey = (tournamentId: string) =>
  ["preview-squad-slots", tournamentId] as const;

const squadSlotLayoutPreview = {
  tournamentId: "resume-boundary",
  teamSize: 4,
  capacity: 12,
  filledTeams: 1,
  filledPlayers: 1,
  registrationClosed: false,
  alreadyRegistered: false,
  myTeamNumber: null,
  mySlotNumber: null,
  teams: [{
    teamNumber: 1,
    legacy: false,
    captainGameName: "Captain",
    slots: [
      { slotNumber: 1, occupied: true, gameName: "Captain", isCaptain: true, canJoin: false, canRemove: false, registrationId: null },
      { slotNumber: 2, occupied: false, gameName: null, isCaptain: false, canJoin: true, canRemove: false, registrationId: null },
      { slotNumber: 3, occupied: false, gameName: null, isCaptain: false, canJoin: true, canRemove: false, registrationId: null },
      { slotNumber: 4, occupied: false, gameName: null, isCaptain: false, canJoin: true, canRemove: false, registrationId: null },
    ],
  }],
};

export function useDaily007V2GetSquadSlots(_tournamentId: string, _options?: unknown) {
  const showLayoutFixture = Boolean(
    (globalThis as typeof globalThis & { __daily007SquadSlotsLayoutPreview?: boolean })
      .__daily007SquadSlotsLayoutPreview,
  );
  return noQuery(showLayoutFixture ? squadSlotLayoutPreview : { slots: [] });
}

export function useDaily007V2JoinSquadSlot() {
  return noMutation();
}

export function useDaily007V2RemoveSquadMember() {
  return noMutation();
}
