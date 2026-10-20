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
const previewFullAdminRecoveryUser = {
  $id: "preview-full-admin-recovery",
  name: "Full Admin Recovery Preview",
  email: "full-admin-recovery@example.invalid",
  coins: 0,
  status: "active",
  role: "admin",
  createdAt: "2026-10-06T10:00:00.000Z",
};
let recoveryPreviewUserPresent = true;

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
    id: "preview-registration-pending-rejection-2026",
    userId: previewAdminUsers[1].$id,
    playerName: "Rohan Free Fire Strategist",
    teamName: "Preview Registration To Reject",
    captainGameName: "RohanReservePlayer",
    gameUid: "FFUID-22113344556677889900",
    tournamentId: "preview-tournament-international-grand-finals-2026",
    tournamentName: "Daily007 International Free Fire Championship Grand Finals",
    mode: "Battle Royale",
    teamType: "Squad",
    entryCoins: 76543,
    status: "pending",
    createdAt: "2026-10-05T07:20:00.000Z",
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
  {
    id: "preview-payment-pending-rejection-2026",
    userId: "preview-user-payment-rejection-2026",
    userName: "Kavya Championship Deposit To Reject",
    coins: 76543,
    amount: 76543,
    payerUpiId: "kavya.daily007.preview.payer@upi",
    txnId: "PREVIEW-UTR-20261005-221133445566778899",
    status: "pending",
    proofAvailable: false,
    createdAt: "2026-10-05T07:55:00.000Z",
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
    id: "preview-withdrawal-pending-approval-2026",
    userId: "preview-user-withdrawal-approval-2026",
    userName: "Meera Pending Payout To Approve",
    coins: 3210,
    amount: 3210,
    method: "upi",
    account: "meera.preview.payout@upi",
    status: "pending",
    createdAt: "2026-10-05T08:50:00.000Z",
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
  {
    id: "preview-withdrawal-approved-control-2026",
    userId: "preview-user-approved-payout-control-2026",
    userName: "Control Approved Payout Player",
    coins: 2468,
    amount: 2468,
    method: "upi",
    account: "control.preview.payout@upi",
    status: "approved",
    payoutStatus: "manual_payout_required",
    createdAt: "2026-10-04T14:30:00.000Z",
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

let adminPreviewTransactionSequence = 0;

function findPreviewAdminRecord<T extends { id: string }>(
  records: T[],
  id: string,
  recordType: string,
): T {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Isolated preview ${recordType} ${id} was not found.`);
  return record;
}

function findPreviewAdminUser(userId: string) {
  const user = [...previewAdminUsers, ...previewNotificationRecipients]
    .find((candidate) => candidate.$id === userId);
  if (!user) throw new Error(`Isolated preview user ${userId} was not found.`);
  return user;
}

function setPreviewRequestStatus<T extends { id: string; status: string }>(
  records: T[],
  id: string,
  action: string,
  recordType: string,
  reason?: string,
) {
  if (action !== "approve" && action !== "reject") {
    throw new Error(`Unsupported isolated preview ${recordType} action: ${action}.`);
  }
  const record = findPreviewAdminRecord(records, id, recordType);
  record.status = action === "approve" ? "approved" : "rejected";
  if (reason !== undefined) Object.assign(record, { reviewReason: reason });
  if (recordType === "withdrawal" && action === "approve") {
    Object.assign(record, { payoutStatus: "manual_payout_required" });
  }
  return { ...record };
}

const empty = async () => [];
type PreviewSessionIdentity = {
  revision: number;
  accountId?: string;
  token: string;
};

export function captureSessionIdentity(): PreviewSessionIdentity | null {
  return null;
}

export function isSessionIdentityCurrent(_identity: PreviewSessionIdentity): boolean {
  return false;
}

export async function setSessionForIdentity(
  _user: unknown,
  _identity: PreviewSessionIdentity,
): Promise<boolean> {
  return false;
}

let tournamentReadCount = 0;
let tournamentDetailReadCount = 0;
let nextTournamentReadError: string | null = null;
let nextMyRegistrationReadError: string | null = null;
let nextAdminUsersReadError: string | null = null;
let emptyNextAdminUsersRead = false;
let nextMyRegistrationReadResponse: { value: unknown } | null = null;
let deferredTournamentRead: {
  promise: Promise<any[]>;
  resolve: (tournaments: any[]) => void;
  reject: (error: Error) => void;
  claimed: boolean;
} | null = null;
let playerLargestTextPreview = false;
let playerPreviewProfile = {
  name: "Daily007 Champion With A Long Player Name",
  phone: "+91 98765 43210",
  gameUid: "12345678901234567890",
};
let istDateSurfacePreview = false;
let myRegistrationReadCount = 0;
let myRegistrationPreview: any[] | null = null;
let homeCarouselRegistrationPreview = false;
let deferredHomeRegistrationRead: {
  promise: Promise<any[]>;
  resolve: (registrations: any[]) => void;
  reject: (error: Error) => void;
  claimed: boolean;
} | null = null;
export const walletPreviewCalls: { method: string; payload?: unknown }[] = [];
let previewAdminAdjustmentRequestSequence = 0;
export function newAdminAdjustmentRequestId(): string {
  previewAdminAdjustmentRequestSequence += 1;
  return `00000000-0000-4000-8000-${String(previewAdminAdjustmentRequestSequence).padStart(12, "0")}`;
}

type AdminPreviewMutationCall = { method: string; [key: string]: unknown };
type AdminPreviewRejectedMutationResult = {
  category: string;
  error: string;
  rejected: boolean;
  fixturesUnchanged: boolean;
  reportedAsSuccess: boolean;
};
const adminPreviewMutationCalls: AdminPreviewMutationCall[] = [];
const adminPreviewMutationFailures = new Map<string, string>();
let deferredAdminNotificationSend: {
  promise: Promise<void>;
  resolve: () => void;
  claimed: boolean;
} | null = null;
function snapshotAdminPreviewFixtures() {
  return JSON.parse(JSON.stringify({
    registrations: previewAdminRegistrations,
    payments: previewAdminPayments,
    withdrawals: previewAdminWithdrawals,
    users: previewAdminUsers,
    notificationRecipients: previewNotificationRecipients,
    transactions: previewAdminTransactions,
  }));
}
let runAdminPreviewRejectedMutationProbes = async (): Promise<AdminPreviewRejectedMutationResult[]> => [];

const adminPreviewMutations = {
  calls: adminPreviewMutationCalls,
  snapshot: snapshotAdminPreviewFixtures,
  probeRejectedMutations: () => runAdminPreviewRejectedMutationProbes(),
  reset: () => {
    adminPreviewMutationCalls.length = 0;
    adminPreviewMutationFailures.clear();
    if (deferredAdminNotificationSend) {
      deferredAdminNotificationSend.resolve();
      deferredAdminNotificationSend = null;
    }
    nextAdminUsersReadError = null;
    emptyNextAdminUsersRead = false;
    previewFullAdminRecoveryUser.role = "admin";
    recoveryPreviewUserPresent = true;
  },
  holdNextNotificationSend: () => {
    if (deferredAdminNotificationSend) {
      throw new Error("An isolated Admin notification send is already being held.");
    }
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    deferredAdminNotificationSend = { promise, resolve, claimed: false };
  },
  releaseHeldNotificationSend: () => {
    const deferred = deferredAdminNotificationSend;
    if (!deferred?.claimed) return false;
    deferredAdminNotificationSend = null;
    deferred.resolve();
    return true;
  },
  failNext: (method: string, message: string) => {
    if (!method.trim() || !message.trim()) {
      throw new Error("An isolated Admin preview failure needs a method and an error message.");
    }
    adminPreviewMutationFailures.set(method, message);
  },
  failNextUserRead: (message: string) => {
    if (!message.trim()) {
      throw new Error("An isolated Admin preview user-list failure needs an error message.");
    }
    nextAdminUsersReadError = message;
  },
  returnEmptyUserListOnce: () => {
    emptyNextAdminUsersRead = true;
  },
  changeRecoveryPreviewRole: (role: "admin" | "tournament_admin" | "user") => {
    previewFullAdminRecoveryUser.role = role;
  },
  removeRecoveryPreviewUser: () => {
    recoveryPreviewUserPresent = false;
  },
};
(globalThis as typeof globalThis & {
  __daily007AdminMutations?: typeof adminPreviewMutations;
}).__daily007AdminMutations = adminPreviewMutations;

function throwIfAdminPreviewMutationFails(method: string) {
  const message = adminPreviewMutationFailures.get(method);
  if (message === undefined) return;
  adminPreviewMutationFailures.delete(method);
  throw new Error(message);
}

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
export function updateTournamentPreview(updates: Record<string, unknown>) {
  const date = String(updates.date ?? "");
  const time = String(updates.time ?? "");
  const timeParts = /^(\d{1,2}):(\d{2})\s+(AM|PM)$/i.exec(time);
  const startsAt = /^\d{4}-\d{2}-\d{2}$/.test(date) && timeParts
    ? new Date(
        `${date}T${String(Number(timeParts[1]) % 12 + (timeParts[3].toUpperCase() === "PM" ? 12 : 0)).padStart(2, "0")}:${timeParts[2]}:00+05:30`,
      )
    : null;
  const normalizedUpdates = startsAt && Number.isFinite(startsAt.getTime())
    ? { ...updates, startsAt: startsAt.toISOString() }
    : updates;
  const updatedTournament = previewTournaments[0]
    ? Object.assign(previewTournaments[0], normalizedUpdates)
    : null;
  if (largestTextTournaments[0]) Object.assign(largestTextTournaments[0], normalizedUpdates);
  if (updatedTournament) {
    window.sessionStorage.setItem(
      "daily007-admin-edited-tournament-home-refresh",
      JSON.stringify(updatedTournament),
    );
  }
  return updatedTournament ? { ...updatedTournament } : null;
}
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
const istDateSurfaceTournament = {
  id: "ist-date-boundary",
  name: "New Year IST Match",
  mode: "Battle Royale",
  teamType: "Solo",
  gameMode: "battle_royale",
  date: "2030-01-01",
  time: "12:15 AM",
  startsAt: "2029-12-31T18:45:00.000Z",
  entryCoins: 0,
  prizePool: 500,
  totalSlots: 48,
  filledSlots: 2,
  filledPlayerSlots: 2,
  totalPlayerSlots: 48,
  status: "upcoming",
  enabled: true,
  prizeDist: "1st: 500 coins",
};
const istDateSurfaceRegistration = {
  id: "ist-date-boundary-registration",
  tournamentId: istDateSurfaceTournament.id,
  status: "approved",
  teamName: "New Year Test Team",
  tournament: { ...istDateSurfaceTournament },
};

export function configurePlayerLargestTextPreview() {
  playerLargestTextPreview = true;
  (globalThis as any).__daily007LargestTextApiCalls = walletPreviewCalls;
  (globalThis as any).__daily007HomeRefreshNoticeTest = {
    getTournamentReadCount,
    failNextTournamentRead,
  };
}

export function getPlayerPreviewProfile() {
  return { ...playerPreviewProfile };
}

export function configureIstDateSurfacePreview(
  schedule: { date: string; time: string; startsAt?: string } = {
    date: istDateSurfaceTournament.date,
    time: istDateSurfaceTournament.time,
    startsAt: istDateSurfaceTournament.startsAt,
  },
) {
  istDateSurfacePreview = true;
  Object.assign(istDateSurfaceTournament, schedule);
  Object.assign(istDateSurfaceRegistration.tournament, schedule);
  if (schedule.startsAt === undefined) {
    Reflect.deleteProperty(istDateSurfaceTournament, "startsAt");
    Reflect.deleteProperty(istDateSurfaceRegistration.tournament, "startsAt");
  }
  return { ...istDateSurfaceTournament };
}

export function configureAdminTournamentEmptyFilterPreview() {
  const upcomingTournament = previewTournaments.find(
    (tournament) => String(tournament.id) === "preview-upcoming",
  );
  if (!upcomingTournament) {
    throw new Error("The isolated Admin filter preview needs its upcoming tournament fixture.");
  }
  previewTournaments.splice(0, previewTournaments.length, { ...upcomingTournament });
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

function addPreviewTournamentFromAdminPayload(payload: Record<string, unknown>) {
  const date = String(payload.date ?? "");
  const time = String(payload.time ?? "");
  const timeParts = /^(\d{1,2}):(\d{2})\s+(AM|PM)$/i.exec(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !timeParts) {
    throw new Error("The Admin preview needs a valid tournament date and IST time.");
  }

  const hour = Number(timeParts[1]) % 12 + (timeParts[3].toUpperCase() === "PM" ? 12 : 0);
  const startsAt = new Date(
    `${date}T${String(hour).padStart(2, "0")}:${timeParts[2]}:00+05:30`,
  );
  if (!Number.isFinite(startsAt.getTime())) {
    throw new Error("The Admin preview could not parse the tournament start time.");
  }

  const mode = String(payload.mode ?? "");
  const teamType = String(payload.teamType ?? "");
  const totalSlots = Number(payload.totalSlots ?? 0);
  const teamSize = teamType.toLowerCase() === "duo"
    ? 2
    : teamType.toLowerCase() === "squad"
      ? 4
      : 1;
  const createdTournament = {
    id: `preview-created-admin-${previewTournaments.filter((tournament) =>
      String(tournament.id).startsWith("preview-created-admin-")).length + 1}`,
    name: String(payload.name ?? ""),
    mode,
    gameMode: mode.toLowerCase().replace(/\s+/g, "_"),
    teamType,
    date,
    time,
    startsAt: startsAt.toISOString(),
    entryCoins: Number(payload.entryCoins ?? 0),
    prizePool: Number(payload.prizePool ?? 0),
    totalSlots,
    filledSlots: 0,
    filledPlayerSlots: 0,
    totalPlayerSlots: totalSlots * teamSize,
    status: "upcoming",
    enabled: true,
    rules: String(payload.rules ?? ""),
    banner: String(payload.banner ?? ""),
    imageUrl: typeof payload.imageUrl === "string" ? payload.imageUrl : null,
    prizeDist: String(payload.prizeDist ?? ""),
  };
  previewTournaments.push(createdTournament);
  window.sessionStorage.setItem(
    "daily007-admin-created-tournament-home-refresh",
    JSON.stringify(createdTournament),
  );
  return createdTournament;
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
    const previewControls = globalThis as typeof globalThis & {
      __daily007FailNextProfileSave?: boolean;
    };
    if (previewControls.__daily007FailNextProfileSave === true) {
      previewControls.__daily007FailNextProfileSave = false;
      const error = new Error("Profile update request timed out.");
      Object.assign(error, {
        response: {
          data: { error: "Could not save your profile. Please try again." },
        },
      });
      throw error;
    }
    const profile = payload as Partial<typeof playerPreviewProfile>;
    playerPreviewProfile = {
      name: String(profile?.name ?? playerPreviewProfile.name),
      phone: String(profile?.phone ?? playerPreviewProfile.phone),
      gameUid: String(profile?.gameUid ?? playerPreviewProfile.gameUid),
    };
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
  adminUsers: async () => {
    if (nextAdminUsersReadError !== null) {
      const error = nextAdminUsersReadError;
      nextAdminUsersReadError = null;
      throw new Error(error);
    }
    if (emptyNextAdminUsersRead) {
      emptyNextAdminUsersRead = false;
      return [];
    }
    const recoveryPreviewEnabled = typeof window !== "undefined"
      && new URLSearchParams(window.location.search).has("admin-full-admin-recovery-only");
    return [
      ...previewAdminUsers,
      ...(recoveryPreviewEnabled && recoveryPreviewUserPresent ? [previewFullAdminRecoveryUser] : []),
      ...(isAdminLargestTextPreview() ? previewNotificationRecipients : []),
    ].map((user) => ({ ...user }));
  },
  tournament: async (id: string) => {
    tournamentDetailReadCount += 1;
    const tournament = istDateSurfacePreview && String(id) === istDateSurfaceTournament.id
      ? istDateSurfaceTournament
      : [...largestTextTournaments, ...previewTournaments].find((item) => String(item.id) === String(id));
    if (!tournament) throw new Error(`Preview tournament ${id} was not found.`);
    return { ...tournament };
  },
  tournaments: async (query: string | boolean = "") => {
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
    const createdPreviewTournaments = previewTournaments.filter((tournament) =>
      String(tournament.id).startsWith("preview-created-admin-"));
    const tournaments = istDateSurfacePreview
      ? [istDateSurfaceTournament]
      : isAdminLargestTextPreview()
        && !homeCarouselRegistrationPreview
        ? [...largestTextTournaments, ...createdPreviewTournaments]
        : playerLargestTextPreview
          ? largestTextTournaments
          : previewTournaments;
    const enabledOnly = query === true || String(query).includes("enabled=true");
    return (enabledOnly ? tournaments.filter((tournament) => tournament.enabled) : tournaments)
      .map((tournament) => ({ ...tournament }));
  },
  myRegistrations: async () => {
    myRegistrationReadCount += 1;
    if (nextMyRegistrationReadError !== null) {
      const error = nextMyRegistrationReadError;
      nextMyRegistrationReadError = null;
      throw new Error(error);
    }
    if (nextMyRegistrationReadResponse !== null) {
      const { value } = nextMyRegistrationReadResponse;
      nextMyRegistrationReadResponse = null;
      return value;
    }
    if (istDateSurfacePreview) {
      return [{ ...istDateSurfaceRegistration, tournament: { ...istDateSurfaceTournament } }];
    }
    if (playerLargestTextPreview) {
      return largestTextRegistrations.map((registration) => ({ ...registration }));
    }
    if (myRegistrationPreview !== null) {
      if (deferredHomeRegistrationRead && !deferredHomeRegistrationRead.claimed) {
        deferredHomeRegistrationRead.claimed = true;
        return deferredHomeRegistrationRead.promise;
      }
      return myRegistrationPreview.map((registration) => ({ ...registration }));
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
  updateTournament: async (id: string, payload: Record<string, unknown>) => {
    throwIfAdminPreviewMutationFails("updateTournament");
    adminPreviewMutationCalls.push({
      method: "updateTournament",
      id,
      payload: { ...payload },
    });
    updateTournamentPreview(payload);
    return {};
  },
  createTournament: async (payload: Record<string, unknown>) => {
    adminPreviewMutationCalls.push({ method: "createTournament", payload: { ...payload } });
    const createdTournament = addPreviewTournamentFromAdminPayload(payload);
    return { ...createdTournament };
  },
  deleteTournament: async (id: string) => {
    const tournamentIndex = previewTournaments.findIndex((item) => String(item.id) === String(id));
    if (tournamentIndex < 0) throw new Error(`Preview tournament ${id} was not found.`);
    const tournament = previewTournaments[tournamentIndex];
    adminPreviewMutationCalls.push({ method: "deleteTournament", id });
    if (Number(tournament.filledSlots ?? 0) > 0 ||
      previewAdminRegistrations.some((registration) => String(registration.tournamentId) === String(id))) {
      tournament.enabled = false;
      return { deleted: false, closed: true, enabled: false };
    }
    previewTournaments.splice(tournamentIndex, 1);
    return { deleted: true };
  },
  adminAdjustCoins: async (userId: string, amount: number, reason: string) => {
    throwIfAdminPreviewMutationFails("adminAdjustCoins");
    if (!Number.isSafeInteger(amount) || amount === 0) {
      throw new Error("Preview wallet adjustments must use a nonzero whole number of coins.");
    }
    const user = findPreviewAdminUser(userId);
    const nextBalance = Number(user.coins ?? 0) + amount;
    if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) {
      throw new Error(`Preview wallet adjustment would make ${user.name}'s balance invalid.`);
    }
    user.coins = nextBalance;
    previewAdminTransactions.unshift({
      $id: `preview-admin-adjustment-${++adminPreviewTransactionSequence}`,
      title: `${reason} · ${user.name}`,
      note: reason,
      coins: amount,
      createdAt: new Date().toISOString(),
    });
    adminPreviewMutationCalls.push({ method: "adminAdjustCoins", userId, amount, reason });
    return { userId, coins: nextBalance };
  },
  adminDeleteRegistration: async (id: string) => {
    throwIfAdminPreviewMutationFails("adminDeleteRegistration");
    const index = previewAdminRegistrations.findIndex((registration) => registration.id === id);
    if (index === -1) throw new Error(`Isolated preview registration ${id} was not found.`);
    previewAdminRegistrations.splice(index, 1);
    adminPreviewMutationCalls.push({ method: "adminDeleteRegistration", id });
    return { id, deleted: true };
  },
  adminMarkWithdrawalPaid: async (id: string) => {
    throwIfAdminPreviewMutationFails("adminMarkWithdrawalPaid");
    const withdrawal = findPreviewAdminRecord(previewAdminWithdrawals, id, "withdrawal");
    if (withdrawal.status !== "approved" || withdrawal.payoutStatus !== "manual_payout_required") {
      throw new Error(`Isolated preview withdrawal ${id} is not awaiting a manual payout.`);
    }
    withdrawal.payoutStatus = "paid";
    adminPreviewMutationCalls.push({ method: "adminMarkWithdrawalPaid", id });
    return { id, payoutStatus: "paid" };
  },
  adminPaymentAction: async (id: string, action: string, reason?: string) => {
    throwIfAdminPreviewMutationFails("adminPaymentAction");
    const payment = setPreviewRequestStatus(
      previewAdminPayments,
      id,
      action,
      "payment",
      reason,
    );
    adminPreviewMutationCalls.push({
      method: "adminPaymentAction",
      id,
      action,
      ...(reason === undefined ? {} : { reason }),
    });
    return payment;
  },
  adminPaymentProofUrl: async () => ({ url: "" }),
  adminRegAction: async (id: string, action: string) => {
    throwIfAdminPreviewMutationFails("adminRegAction");
    const registration = setPreviewRequestStatus(
      previewAdminRegistrations,
      id,
      action,
      "registration",
    );
    adminPreviewMutationCalls.push({ method: "adminRegAction", id, action });
    return registration;
  },
  adminSendNotification: async (payload: Record<string, unknown>) => {
    adminPreviewMutationCalls.push({
      method: "adminSendNotification",
      payload: {
        ...payload,
        ...(Array.isArray(payload.userIds) ? { userIds: [...payload.userIds] } : {}),
      },
    });
    const deferred = deferredAdminNotificationSend;
    if (deferred) {
      deferred.claimed = true;
      await deferred.promise;
    }
    return {};
  },
  adminSetUser: async (id: string, payload: Record<string, unknown>) => {
    throwIfAdminPreviewMutationFails("adminSetUser");
    const user = findPreviewAdminUser(id);
    if (payload.status !== "active" && payload.status !== "blocked") {
      throw new Error(`Unsupported isolated preview user status: ${String(payload.status)}.`);
    }
    user.status = payload.status;
    adminPreviewMutationCalls.push({ method: "adminSetUser", id, payload: { ...payload } });
    return { ...user };
  },
  adminSetUserRole: async (id: string, role: string) => {
    throwIfAdminPreviewMutationFails("adminSetUserRole");
    if (role !== "user" && role !== "tournament_admin") {
      throw new Error(`Unsupported isolated preview user role: ${role}.`);
    }
    const user = findPreviewAdminUser(id);
    user.role = role;
    adminPreviewMutationCalls.push({ method: "adminSetUserRole", id, role });
    return { ...user };
  },
  adminWithdrawalAction: async (id: string, action: string, reason?: string) => {
    throwIfAdminPreviewMutationFails("adminWithdrawalAction");
    const withdrawal = setPreviewRequestStatus(
      previewAdminWithdrawals,
      id,
      action,
      "withdrawal",
      reason,
    );
    adminPreviewMutationCalls.push({
      method: "adminWithdrawalAction",
      id,
      action,
      ...(reason === undefined ? {} : { reason }),
    });
    return withdrawal;
  },
};

runAdminPreviewRejectedMutationProbes = async () => {
  const knownUserId = "preview-user-ananya-championship-2026";
  const probes: { category: string; run: () => Promise<unknown> }[] = [
    {
      category: "registration",
      run: () => Api.adminRegAction("unknown-preview-registration", "approve"),
    },
    {
      category: "payment",
      run: () => Api.adminPaymentAction("unknown-preview-payment", "approve"),
    },
    {
      category: "wallet",
      run: () => Api.adminAdjustCoins(knownUserId, Number.MAX_SAFE_INTEGER, "Rejected preview probe"),
    },
    {
      category: "user status",
      run: () => Api.adminSetUser(knownUserId, { status: "suspended" }),
    },
    {
      category: "user role",
      run: () => Api.adminSetUserRole(knownUserId, "admin"),
    },
  ];
  const outcomes: AdminPreviewRejectedMutationResult[] = [];
  for (const probe of probes) {
    adminPreviewMutationCalls.length = 0;
    adminPreviewMutationFailures.clear();
    const fixturesBefore = JSON.stringify(snapshotAdminPreviewFixtures());
    let error = "";
    try {
      await probe.run();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    const fixturesAfter = JSON.stringify(snapshotAdminPreviewFixtures());
    outcomes.push({
      category: probe.category,
      error,
      rejected: error.length > 0,
      fixturesUnchanged: fixturesBefore === fixturesAfter,
      reportedAsSuccess: adminPreviewMutationCalls.length > 0,
    });
  }
  adminPreviewMutationCalls.length = 0;
  return outcomes;
};

export function getTournamentReadCount() {
  return tournamentReadCount;
}

export function getTournamentDetailReadCount() {
  return tournamentDetailReadCount;
}

export function configureHomeCarouselRegistrationPreview(registrations: any[] = []) {
  homeCarouselRegistrationPreview = true;
  configureMyRegistrationPreview(registrations);
}

export function configureMyRegistrationPreview(registrations: any[] = []) {
  myRegistrationPreview = registrations.map((registration) => ({ ...registration }));
  myRegistrationReadCount = 0;
  nextMyRegistrationReadResponse = null;
}

export function setHomeCarouselRegistrationPreview(registrations: any[]) {
  setMyRegistrationPreview(registrations);
}

export function setMyRegistrationPreview(registrations: any[]) {
  myRegistrationPreview = registrations.map((registration) => ({ ...registration }));
}

export function setNextMyRegistrationReadResponse(value: unknown) {
  nextMyRegistrationReadResponse = { value };
}

export function deferNextHomeCarouselRegistrationRead() {
  let resolve!: (registrations: any[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  deferredHomeRegistrationRead = { promise, resolve, reject, claimed: false };
}

export function releaseHomeCarouselRegistrationRead(registrations = myRegistrationPreview ?? []) {
  const deferred = deferredHomeRegistrationRead;
  if (!deferred) return false;
  deferredHomeRegistrationRead = null;
  deferred.resolve(registrations.map((registration) => ({ ...registration })));
  return true;
}

export function failDeferredHomeCarouselRegistrationRead(
  message = "Temporary registration refresh failure",
) {
  const deferred = deferredHomeRegistrationRead;
  if (!deferred?.claimed) return false;
  deferredHomeRegistrationRead = null;
  deferred.reject(new Error(message));
  return true;
}

export function getMyRegistrationReadCount() {
  return myRegistrationReadCount;
}

export function failNextHomeCarouselRegistrationRead(message = "Temporary registration refresh failure") {
  failNextMyRegistrationRead(message);
}

export function failNextMyRegistrationRead(message = "Temporary registration refresh failure") {
  nextMyRegistrationReadError = message;
}

export function resetTournamentReadCount() {
  tournamentReadCount = 0;
}

export function deferNextTournamentRead() {
  if (deferredTournamentRead) throw new Error("A tournament read is already deferred.");
  let resolve!: (tournaments: any[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  deferredTournamentRead = { promise, resolve, reject, claimed: false };
}

export function resolveDeferredTournamentRead(tournaments: any[]) {
  const deferred = deferredTournamentRead;
  if (!deferred?.claimed) return false;
  deferredTournamentRead = null;
  deferred.resolve(tournaments.map((tournament) => ({ ...tournament })));
  return true;
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