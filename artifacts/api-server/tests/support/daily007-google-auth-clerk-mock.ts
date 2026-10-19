export type User = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  emailAddresses?: Array<{
    emailAddress: string;
    verification?: { status?: string | null } | null;
  }>;
  externalAccounts?: Array<{
    provider: string;
    emailAddress?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    verification?: { status?: string | null } | null;
  }>;
};

type MockRequest = {
  auth?: { userId?: string | null };
};

let mockGoogleUsers = new Map<string, User>();
let userLookupCount = 0;
let nextGoogleUserLookupFailure: Error | null = null;
let nextGoogleUserLookupHang: {
  wait: Promise<void>;
  release: () => void;
} | null = null;

export function resetMockGoogleUser(user: User | null = null): void {
  resetMockGoogleUsers(user ? [user] : []);
}

export function resetMockGoogleUsers(users: User[] = []): void {
  mockGoogleUsers = new Map(users.map((user) => [user.id, structuredClone(user)]));
  userLookupCount = 0;
  nextGoogleUserLookupFailure = null;
  nextGoogleUserLookupHang = null;
}

export function failNextMockGoogleUserLookup(): void {
  nextGoogleUserLookupFailure = new Error("Simulated temporary Clerk user lookup failure.");
  nextGoogleUserLookupHang = null;
}

export function hangNextMockGoogleUserLookup(): { release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  nextGoogleUserLookupFailure = null;
  nextGoogleUserLookupHang = { wait, release };
  return { release };
}

export function updateMockGoogleUser(user: User): void {
  if (!mockGoogleUsers.has(user.id)) {
    throw new Error(`No matching mocked Google identity is configured for ${user.id}.`);
  }
  mockGoogleUsers.set(user.id, structuredClone(user));
}

export function getMockGoogleUserLookupCount(): number {
  return userLookupCount;
}

export function getAuth(req: MockRequest): { userId?: string | null } {
  return req.auth ?? {};
}

export const clerkClient = {
  users: {
    async getUser(userId: string): Promise<User> {
      userLookupCount += 1;
      const failure = nextGoogleUserLookupFailure;
      nextGoogleUserLookupFailure = null;
      if (failure) throw failure;
      const hangingLookup = nextGoogleUserLookupHang;
      nextGoogleUserLookupHang = null;
      if (hangingLookup) {
        await hangingLookup.wait;
      }
      const user = mockGoogleUsers.get(userId);
      if (!user) {
        throw new Error("No matching mocked Google identity is configured.");
      }
      return structuredClone(user);
    },
  },
};