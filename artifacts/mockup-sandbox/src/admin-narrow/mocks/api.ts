const now = Date.now();

export const previewTournaments = [
  {
    id: "preview-upcoming",
    name: "Narrow Preview Upcoming",
    mode: "Battle Royale",
    teamType: "Solo",
    gameMode: "battle_royale",
    date: "2030-05-10",
    time: "08:00 PM",
    startsAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    entryCoins: 20,
    prizePool: 500,
    totalSlots: 48,
    filledSlots: 4,
    filledPlayerSlots: 4,
    totalPlayerSlots: 48,
    status: "upcoming",
    enabled: true,
    prizeDist: "1st: 500 coins\n2nd: 250 coins",
  },
  {
    id: "preview-ongoing",
    name: "Narrow Preview Ongoing",
    mode: "Clash Squad",
    teamType: "Squad",
    gameMode: "clash_squad",
    date: "2030-05-09",
    time: "07:30 PM",
    startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
    entryCoins: 15,
    prizePool: 500,
    totalSlots: 12,
    filledSlots: 10,
    filledPlayerSlots: 40,
    totalPlayerSlots: 48,
    status: "ongoing",
    enabled: true,
    prizeDist: "1st: 500 coins\n2nd: 250 coins",
  },
  {
    id: "preview-completed",
    name: "Narrow Preview Completed",
    mode: "Lone Wolf",
    teamType: "Solo",
    gameMode: "lone_wolf",
    date: "2030-05-08",
    time: "06:00 PM",
    startsAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
    entryCoins: 10,
    prizePool: 300,
    totalSlots: 16,
    filledSlots: 16,
    filledPlayerSlots: 16,
    totalPlayerSlots: 16,
    status: "completed",
    enabled: true,
  },
];

const previewAdmin = {
  id: "preview-admin",
  name: "Preview Admin",
  email: "admin.preview@example.invalid",
  role: "admin" as const,
  coins: 0,
};

const settings = {
  appName: "Free Fire Daily007",
  coinToMoneyRate: 1,
  minWithdrawal: 100,
  maxWithdrawal: 5000,
  rechargeEnabled: false,
  withdrawalEnabled: false,
  youtubeTaskEnabled: false,
};

const stats = {
  totalUsers: 0,
  activeTournaments: previewTournaments.length,
  pendingRegistrations: 0,
  approvedRegistrations: 0,
  pendingPayments: 0,
  completedTournaments: 1,
  coinsDistributed: 0,
  coinsInWallets: 0,
  prizeDistributed: 0,
  todayRegistrations: 0,
  todayRevenue: 0,
};

const empty = async () => [];
let tournamentReadCount = 0;
let playerLargestTextPreview = false;
export const walletPreviewCalls: { method: string; payload?: unknown }[] = [];

const longTournamentName =
  "Daily007 International Free Fire Championship Grand Finals";
const largestTextTournaments = previewTournaments.map((tournament) => ({
  ...tournament,
  name: longTournamentName,
}));
const largestTextRegistrations = [
  {
    id: "largest-text-upcoming-registration",
    tournamentId: "preview-upcoming",
    status: "approved",
    teamName: "Unstoppable Champions of the Daily007 International League",
    tournament: { ...largestTextTournaments[0] },
  },
  {
    id: "largest-text-completed-registration",
    tournamentId: "preview-completed",
    status: "approved",
    tournament: {
      ...largestTextTournaments[2],
      results: [
        {
          rank: 1,
          kills: 12,
          prizeCoins: 2500,
          gameName: "Champion With A Long In-Game Name",
          playerName: "A Player Name That Needs Several Lines",
          teamName: "Daily007 Finals Champions",
        },
      ],
    },
  },
];
const walletCancellationRefundDescription =
  "Entry fee refunded — Daily007 Clash Finals (tournament cancelled)";

export function configurePlayerLargestTextPreview() {
  playerLargestTextPreview = true;
}

export function configureWalletFormPreview() {
  Object.assign(settings, {
    coinToMoneyRate: 1,
    minPurchase: 1,
    maxPurchase: 5000,
    coinPackages: "",
    minWithdrawal: 100,
    maxWithdrawal: 5000,
    rechargeEnabled: true,
    withdrawalEnabled: true,
    upiId: "daily007-preview@upi",
    upiQrUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    paymentNote: "",
  });
  walletPreviewCalls.length = 0;
}

export const Api = {
  me: async () => ({ ...previewAdmin }),
  settings: async () => ({ settings: { ...settings } }),
  transactions: async () => playerLargestTextPreview
    ? [{
        id: "largest-text-cancellation-refund",
        amount: 35,
        balanceAfter: 155,
        reason: "tournament_cancel_refund",
        details: { description: walletCancellationRefundDescription },
        description: walletCancellationRefundDescription,
        createdAt: new Date(now).toISOString(),
      }]
    : empty(),
  myPayments: empty,
  myWithdrawals: empty,
  createPayment: async (payload: unknown) => {
    walletPreviewCalls.push({ method: "createPayment", payload });
    return {};
  },
  withdrawCoins: async (payload: unknown) => {
    walletPreviewCalls.push({ method: "withdrawCoins", payload });
    return {};
  },
  updateProfile: async (payload: unknown) => {
    walletPreviewCalls.push({ method: "updateProfile", payload });
    return {};
  },
  adminStats: async () => ({ ...stats, stats: { ...stats } }),
  adminSettings: async () => ({ ...settings, settings: { ...settings } }),
  adminSaveSettings: async () => ({ ...settings, settings: { ...settings } }),
  adminBootstrapStatus: async () => ({ available: false }),
  adminRegistrations: empty,
  adminPayments: empty,
  adminWithdrawals: empty,
  adminTransactions: empty,
  adminUsers: empty,
  tournaments: async () => {
    tournamentReadCount += 1;
    const tournaments = playerLargestTextPreview ? largestTextTournaments : previewTournaments;
    return tournaments.map((tournament) => ({ ...tournament }));
  },
  myRegistrations: async () => playerLargestTextPreview
    ? largestTextRegistrations.map((registration) => ({ ...registration }))
    : empty(),
  leaderboard: async () => playerLargestTextPreview
    ? Array.from({ length: 12 }, (_, index) => ({
        id: `largest-text-player-${index + 1}`,
        name: index === 0
          ? "Daily007 Championship Player With A Long Display Name"
          : `International Tournament Competitor ${index + 1}`,
        matches: 12345 - index,
        wins: 2345 - index,
        kills: 98765 - index,
        prizeCoins: 54321 - index,
      }))
    : empty(),
  notifications: async () => playerLargestTextPreview
    ? [
        {
          id: "largest-text-notification-1",
          title: "Your tournament registration has been approved",
          body: "You are confirmed for the Daily007 International Free Fire Championship Grand Finals. Room details will be available shortly before the scheduled start.",
          createdAt: new Date(now).toISOString(),
        },
        {
          id: "largest-text-notification-2",
          title: "Your prize coins were added to your wallet",
          body: "The administrator approved your completed tournament result and credited the prize to your Daily007 balance.",
          createdAt: new Date(now - 3_600_000).toISOString(),
        },
      ]
    : empty(),
  adminRoom: async (tournamentId: string) => ({
    tournamentId,
    roomId: "TEST-ROOM-01",
    roomPassword: "test-room-password",
    roomPublished: false,
  }),
  adminApprovedRegs: async (tournamentId: string) =>
    tournamentId === "preview-ongoing"
      ? [
          {
            id: "preview-registration-1",
            tournamentId,
            status: "approved",
            playerName: "Preview Player One",
            gameUid: "TEST-UID-001",
          },
          {
            id: "preview-registration-2",
            tournamentId,
            status: "approved",
            playerName: "Preview Player Two",
            gameUid: "TEST-UID-002",
          },
        ]
      : [],
  adminSaveRoom: async () => ({}),
  adminClearRoom: async () => ({}),
  adminPublishResult: async () => ({}),
  updateTournament: async () => ({}),
  createTournament: async () => ({}),
  deleteTournament: async () => ({}),
  adminAdjustCoins: async () => ({}),
  adminDeleteRegistration: async () => ({}),
  adminMarkWithdrawalPaid: async () => ({}),
  adminPaymentAction: async () => ({}),
  adminPaymentProofUrl: async () => ({ url: "" }),
  adminRegAction: async () => ({}),
  adminSendNotification: async () => ({}),
  adminSetUser: async () => ({}),
  adminSetUserRole: async () => ({}),
  adminWithdrawalAction: async () => ({}),
};

export function getTournamentReadCount() {
  return tournamentReadCount;
}

export function resetTournamentReadCount() {
  tournamentReadCount = 0;
}

export function apiError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const errMessage = apiError;
export const api = Api;