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
export const walletPreviewCalls: { method: string; payload?: unknown }[] = [];

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
  transactions: empty,
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
  adminRegistrations: empty,
  adminPayments: empty,
  adminWithdrawals: empty,
  adminTransactions: empty,
  adminUsers: empty,
  tournaments: async () => {
    tournamentReadCount += 1;
    return previewTournaments.map((tournament) => ({ ...tournament }));
  },
  myRegistrations: empty,
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