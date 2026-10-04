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

let mockGoogleUser: User | null = null;
let userLookupCount = 0;

export function resetMockGoogleUser(user: User | null = null): void {
  mockGoogleUser = user;
  userLookupCount = 0;
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
      if (!mockGoogleUser || mockGoogleUser.id !== userId) {
        throw new Error("No matching mocked Google identity is configured.");
      }
      return structuredClone(mockGoogleUser);
    },
  },
};