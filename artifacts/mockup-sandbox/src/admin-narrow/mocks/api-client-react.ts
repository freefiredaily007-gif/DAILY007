import { useCallback, useState } from "react";

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

type VideoRewardPreviewMode = "unavailable" | "transient" | null;
type VideoRewardPreviewCalls = {
  starts: unknown[];
  completions: unknown[];
  listRefetches: number;
};

let videoRewardPreviewMode: VideoRewardPreviewMode = null;
let transientCompletionFailures = 0;

function getVideoRewardPreviewCalls(): VideoRewardPreviewCalls {
  const preview = globalThis as typeof globalThis & {
    __videoRewardPreviewCalls?: VideoRewardPreviewCalls;
  };
  preview.__videoRewardPreviewCalls ??= { starts: [], completions: [], listRefetches: 0 };
  return preview.__videoRewardPreviewCalls;
}

export function configureVideoRewardPreview(mode: VideoRewardPreviewMode) {
  videoRewardPreviewMode = mode;
  transientCompletionFailures = 0;
  const preview = globalThis as typeof globalThis & {
    __videoRewardPreviewCalls?: VideoRewardPreviewCalls;
  };
  preview.__videoRewardPreviewCalls = { starts: [], completions: [], listRefetches: 0 };
}

export function useDaily007ListVideos() {
  const [refreshCount, setRefreshCount] = useState(0);
  const mode = videoRewardPreviewMode;
  const videos = mode
    ? mode === "unavailable" && refreshCount > 0
      ? rewardPreviewVideos.filter((video) => video.id !== "unavailable-video")
      : rewardPreviewVideos
    : largestTextVideos;
  const refetch = useCallback(async () => {
    getVideoRewardPreviewCalls().listRefetches += 1;
    setRefreshCount((current) => current + 1);
    return {
      data: {
        videos: mode === "unavailable"
          ? rewardPreviewVideos.filter((video) => video.id !== "unavailable-video")
          : rewardPreviewVideos,
      },
    };
  }, [mode]);

  if (mode) {
    return {
      ...noQuery({ videos }),
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
        getVideoRewardPreviewCalls().starts.push(input);
        return { sessionId: "preview-video-watch-session" };
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
        if (mode === "unavailable") {
          const error = new Error("Request failed with status code 409") as Error & {
            response?: { data?: { error?: string } };
          };
          error.response = {
            data: { error: "This video is no longer available for rewards." },
          };
          throw error;
        }
        if (transientCompletionFailures === 0) {
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

export function useDaily007ChangePassword() {
  return noMutation();
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
  return noQuery({ claims: [], totalCompleted: 0 });
}

export function useDaily007AdminReviewYoutubeSubscribeClaim() {
  return noMutation();
}

export function useDaily007AdminListVideos() {
  return noQuery({ videos: [] });
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