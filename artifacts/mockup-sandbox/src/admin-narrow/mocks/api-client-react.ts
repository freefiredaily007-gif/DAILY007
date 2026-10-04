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
  refetch: async () => ({ data }),
});

export const getDaily007ListAdminResultLogsQueryKey = () => [
  "isolated-admin-preview",
  "result-logs",
];

export function useDaily007ListAdminResultLogs() {
  return noQuery({ data: resultLogs });
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