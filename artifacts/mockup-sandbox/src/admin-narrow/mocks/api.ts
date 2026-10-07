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

const previewAdminUsers = [
  {
    $id: "preview-user-ananya-championship-2026",
    name: "Ananya Daily007 Championship Champion With A Long Name",
    email: "ananya.champion.with.a.long.fake.address@example.invalid",
    coins: 987654321,
    status: "active",
    role: "user",
    createdAt: "2026-09-18T09:30:00.000Z",
  },
  {
    $id: "preview-user-rohan-free-fire-2026",
    name: "Rohan Free Fire Strategist",
    email: "rohan.preview.player@example.invalid",
    coins: 425000,
    status: "blocked",
    role: "tournament_admin",
    createdAt: "2026-08-02T14:15:00.000Z",
  },
];

const previewNotificationRecipients = [
  {
    $id: "preview-notification-recipient-meera-2026",
    name: "Meera Daily007 International Free Fire Championship Player",
    email: "meera.international.championship.preview@example.invalid",
    coins: 12000,
    status: "active",
    role: "user",
    createdAt: "2026-09-22T11:20:00.000Z",
  },
  {
    $id: "preview-notification-recipient-kabir-2026",
    name: "Kabir Free Fire National Tournament Finalist and Squad Captain",
    email: "kabir.national.tournament.finalist.preview@example.invalid",
    coins: 8450,
    status: "active",
    role: "user",
    createdAt: "2026-09-14T16:05:00.000Z",
  },
];

const previewAdminRegistrations = [
  {
    id: "preview-registration-pending-long-identifier-2026",
    userId: previewAdminUsers[0].$id,
    playerName: "Ananya Daily007 Championship Champion With A Long Name",
    teamName: "International Free Fire Finals Squad",
    captainGameName: "Ananya_ClutchMaster_001",
    gameUid: "FFUID-99887766554433221100",
    tournamentId: "preview-tournament-international-grand-finals-2026",
    tournamentName: "Daily007 International Free Fire Championship Grand Finals",
    mode: "Battle Royale",
    teamType: "Squad",
    entryCoins: 123456,
    status: "pending",
    createdAt: "2026-10-05T08:45:00.000Z",
  },
  {
    id: "preview-registration-approved-2026",
    userId: previewAdminUsers[1].$id,
    playerName: "Rohan Free Fire Strategist",
    teamName: "Preview Approved Team",
    captainGameName: "RohanStrategist",
    gameUid: "FFUID-11223344556677889900",
    tournamentId: "preview-tournament-international-grand-finals-2026",
    tournamentName: "Daily007 International Free Fire Championship Grand Finals",
    mode: "Battle Royale",
    teamType: "Squad",
    entryCoins: 123456,
    status: "approved",
    createdAt: "2026-10-04T18:20:00.000Z",
  },
  {
    id: "preview-registration-rejected-2026",
    userId: previewAdminUsers[0].$id,
    playerName: "Preview Rejected Player",
    teamName: "Preview Rejected Team",
    captainGameName: "RejectedPreview",
    gameUid: "FFUID-00998877665544332211",
    tournamentId: "preview-tournament-international-grand-finals-2026",
    tournamentName: "Daily007 International Free Fire Championship Grand Finals",
    mode: "Battle Royale",
    teamType: "Squad",
    entryCoins: 123456,
    status: "rejected",
    createdAt: "2026-10-03T11:10:00.000Z",
  },
];

const previewAdminPayments = [
  {
    id: "preview-payment-pending-long-reference-2026",
    userId: "preview-user-ananya-championship-account-2026",
    userName: "Ananya Championship Participant With A Long Display Name",
    coins: 987654321,
    amount: 987654321,
    payerUpiId: "ananya.daily007.preview.payer@upi",
    txnId: "PREVIEW-UTR-20261005-998877665544332211",
    status: "pending",
    proofAvailable: false,
    createdAt: "2026-10-05T09:10:00.000Z",
  },
];

const previewAdminWithdrawals = [
  {
    id: "preview-withdrawal-pending-long-reference-2026",
    userId: "preview-user-rohan-championship-account-2026",
    userName: "Rohan International Tournament Champion",
    coins: 456789123,
    amount: 456789123,
    method: "upi",
    account: "rohan.daily007.long.preview.payout.handle@upi",
    status: "pending",
    createdAt: "2026-10-05T09:25:00.000Z",
  },
  {
    id: "preview-withdrawal-approved-manual-payout-2026",
    userId: "preview-user-approved-payout-2026",
    userName: "Approved Preview Payout Player",
    coins: 789000,
    amount: 789000,
    method: "upi",
    account: "approved.daily007.preview.payout@upi",
    status: "approved",
    payoutStatus: "manual_payout_required",
    createdAt: "2026-10-04T16:40:00.000Z",
  },
];

const previewAdminTransactions = [
  {
    $id: "preview-wallet-transaction-long-identifier-2026",
    title: "International Free Fire Grand Finals entry fee refunded to player wallet",
    note: "Preview-only transaction",
    coins: -987654321,
    createdAt: "2026-10-05T09:35:00.000Z",
  },
];

const empty = async () => [];
let tournamentReadCount = 0;
let nextTournamentReadError: string | null = null;
let nextMyRegistrationReadError: string | null = null;
let deferredTournamentRead: {
  promise: Promise<any[]>;
  reject: (error: Error) => void;
  claimed: boolean;
} | null = null;
let playerLargestTextPreview = false;
let myRegistrationReadCount = 0;
let homeCarouselRegistrationPreview: any[] | null = null;
let deferredHomeRegistrationRead: {
  promise: Promise<any[]>;
  resolve: (registrations: any[]) => void;
  claimed: boolean;
} | null = null;
export const walletPreviewCalls: { method: string; payload?: unknown }[] = [];
type AdminPreviewMutationCall = { method: string; [key: string]: unknown };
const adminPreviewMutationCalls: AdminPreviewMutationCall[] = [];
const adminPreviewMutations = {
  calls: adminPreviewMutationCalls,
  reset: () => {
    adminPreviewMutationCalls.length = 0;
  },
};
(globalThis as typeof globalThis & {
  __daily007AdminMutations?: typeof adminPreviewMutations;
}).__daily007AdminMutations = adminPreviewMutations;

function isAdminLargestTextPreview() {
  const scale = Number(
    (globalThis as typeof globalThis & { __daily007LargeTextScale?: number })
      .__daily007LargeTextScale,
  );
  return Number.isFinite(scale) && scale > 1;
}

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
  adminRegistrations: async () => previewAdminRegistrations.map((registration) => ({ ...registration })),
  adminPayments: async () => previewAdminPayments.map((payment) => ({ ...payment })),
  adminWithdrawals: async () => previewAdminWithdrawals.map((withdrawal) => ({ ...withdrawal })),
  adminTransactions: async () => previewAdminTransactions.map((transaction) => ({ ...transaction })),
  adminUsers: async () => [
    ...previewAdminUsers,
    ...(isAdminLargestTextPreview() ? previewNotificationRecipients : []),
  ].map((user) => ({ ...user })),
  tournaments: async () => {
    tournamentReadCount += 1;
    if (nextTournamentReadError !== null) {
      const error = nextTournamentReadError;
      nextTournamentReadError = null;
      throw new Error(error);
    }
    if (deferredTournamentRead && !deferredTournamentRead.claimed) {
      deferredTournamentRead.claimed = true;
      return deferredTournamentRead.promise;
    }
    const tournaments = isAdminLargestTextPreview() || playerLargestTextPreview
      ? largestTextTournaments
      : previewTournaments;
    return tournaments.map((tournament) => ({ ...tournament }));
  },
  myRegistrations: async () => {
    myRegistrationReadCount += 1;
    if (nextMyRegistrationReadError !== null) {
      const error = nextMyRegistrationReadError;
      nextMyRegistrationReadError = null;
      throw new Error(error);
    }
    if (playerLargestTextPreview) {
      return largestTextRegistrations.map((registration) => ({ ...registration }));
    }
    if (homeCarouselRegistrationPreview !== null) {
      if (deferredHomeRegistrationRead && !deferredHomeRegistrationRead.claimed) {
        deferredHomeRegistrationRead.claimed = true;
        return deferredHomeRegistrationRead.promise;
      }
      return homeCarouselRegistrationPreview.map((registration) => ({ ...registration }));
    }
    return empty();
  },
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
    roomId: isAdminLargestTextPreview()
      ? "FINAL-26"
      : "TEST-ROOM-01",
    roomPassword: isAdminLargestTextPreview()
      ? "D7-Pass26"
      : "test-room-password",
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
  createTournament: async (payload: Record<string, unknown>) => {
    adminPreviewMutationCalls.push({ method: "createTournament", payload: { ...payload } });
    return {};
  },
  deleteTournament: async () => ({}),
  adminAdjustCoins: async (userId: string, amount: number, reason: string) => {
    adminPreviewMutationCalls.push({ method: "adminAdjustCoins", userId, amount, reason });
    return {};
  },
  adminDeleteRegistration: async (id: string) => {
    adminPreviewMutationCalls.push({ method: "adminDeleteRegistration", id });
    return {};
  },
  adminMarkWithdrawalPaid: async (id: string) => {
    adminPreviewMutationCalls.push({ method: "adminMarkWithdrawalPaid", id });
    return {};
  },
  adminPaymentAction: async (id: string, action: string, reason?: string) => {
    adminPreviewMutationCalls.push({
      method: "adminPaymentAction",
      id,
      action,
      ...(reason === undefined ? {} : { reason }),
    });
    return {};
  },
  adminPaymentProofUrl: async () => ({ url: "" }),
  adminRegAction: async (id: string, action: string) => {
    adminPreviewMutationCalls.push({ method: "adminRegAction", id, action });
    return {};
  },
  adminSendNotification: async (payload: Record<string, unknown>) => {
    adminPreviewMutationCalls.push({
      method: "adminSendNotification",
      payload: {
        ...payload,
        ...(Array.isArray(payload.userIds) ? { userIds: [...payload.userIds] } : {}),
      },
    });
    return {};
  },
  adminSetUser: async (id: string, payload: Record<string, unknown>) => {
    adminPreviewMutationCalls.push({ method: "adminSetUser", id, payload: { ...payload } });
    return {};
  },
  adminSetUserRole: async (id: string, role: string) => {
    adminPreviewMutationCalls.push({ method: "adminSetUserRole", id, role });
    return {};
  },
  adminWithdrawalAction: async (id: string, action: string, reason?: string) => {
    adminPreviewMutationCalls.push({
      method: "adminWithdrawalAction",
      id,
      action,
      ...(reason === undefined ? {} : { reason }),
    });
    return {};
  },
};

export function getTournamentReadCount() {
  return tournamentReadCount;
}

export function configureHomeCarouselRegistrationPreview(registrations: any[] = []) {
  homeCarouselRegistrationPreview = registrations.map((registration) => ({ ...registration }));
  myRegistrationReadCount = 0;
}

export function setHomeCarouselRegistrationPreview(registrations: any[]) {
  homeCarouselRegistrationPreview = registrations.map((registration) => ({ ...registration }));
}

export function deferNextHomeCarouselRegistrationRead() {
  let resolve!: (registrations: any[]) => void;
  const promise = new Promise<any[]>((resolvePromise) => {
    resolve = resolvePromise;
  });
  deferredHomeRegistrationRead = { promise, resolve, claimed: false };
}

export function releaseHomeCarouselRegistrationRead(registrations = homeCarouselRegistrationPreview ?? []) {
  const deferred = deferredHomeRegistrationRead;
  if (!deferred) return false;
  deferredHomeRegistrationRead = null;
  deferred.resolve(registrations.map((registration) => ({ ...registration })));
  return true;
}

export function getMyRegistrationReadCount() {
  return myRegistrationReadCount;
}

export function failNextHomeCarouselRegistrationRead(message = "Temporary registration refresh failure") {
  nextMyRegistrationReadError = message;
}

export function resetTournamentReadCount() {
  tournamentReadCount = 0;
}

export function deferNextTournamentRead() {
  if (deferredTournamentRead) throw new Error("A tournament read is already deferred.");
  let reject!: (error: Error) => void;
  const promise = new Promise<any[]>((_, rejectPromise) => {
    reject = rejectPromise;
  });
  deferredTournamentRead = { promise, reject, claimed: false };
}

export function failDeferredTournamentRead(message = "Held retry request failed") {
  const deferred = deferredTournamentRead;
  if (!deferred?.claimed) return false;
  deferredTournamentRead = null;
  deferred.reject(new Error(message));
  return true;
}

export function failNextTournamentRead(message = "Temporary network error") {
  nextTournamentReadError = message;
}

export function apiError(error: unknown) {
  const responseData = (error as {
    response?: { data?: { error?: string; message?: string } };
  } | null)?.response?.data;
  if (responseData?.error || responseData?.message) {
    return responseData.error || responseData.message || "Network error.";
  }
  return error instanceof Error ? error.message : String(error);
}

export const errMessage = apiError;
export const api = Api;