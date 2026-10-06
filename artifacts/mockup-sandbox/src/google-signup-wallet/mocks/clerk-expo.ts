type StartOptions = {
  strategy?: string;
  redirectUrl?: string;
};

const events: string[] = [];
const startOptions: StartOptions[] = [];
const fakeSession = {
  id: "mock-clerk-google-session",
  async getToken() {
    events.push("get-token");
    return "mock-clerk-verified-token";
  },
};

let activeSession: typeof fakeSession | null = null;
let startResultType: string | null = null;

export function resetClerkMock(options: { startResultType?: string | null } = {}) {
  events.length = 0;
  startOptions.length = 0;
  activeSession = null;
  startResultType = options.startResultType ?? null;
}

export function getClerkMockSnapshot() {
  return {
    events: [...events],
    startOptions: [...startOptions],
    activeSessionId: activeSession?.id ?? null,
  };
}

export function useSSO() {
  return {
    async startSSOFlow(options: StartOptions) {
      events.push("start-sso");
      startOptions.push(options);
      if (startResultType) return { authSessionResult: { type: startResultType } };
      return {
        createdSessionId: fakeSession.id,
        async setActive({ session }: { session: string }) {
          events.push("set-active");
          if (session !== fakeSession.id) throw new Error("Unexpected mock Clerk session.");
          activeSession = fakeSession;
        },
      };
    },
  };
}

export function getClerkInstance() {
  return {
    get session() {
      return activeSession;
    },
  };
}

export function useClerk() {
  return { signOut: async () => undefined };
}
