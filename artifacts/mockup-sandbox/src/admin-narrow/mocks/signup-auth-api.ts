const signupCalls: unknown[] = [];

export const Api = {
  login: async () => {
    throw new Error("Login is disabled in the isolated signup keyboard test.");
  },
  register: async (payload: unknown) => {
    signupCalls.push(payload);
    throw new Error("Account creation is disabled in the isolated signup keyboard test.");
  },
};

export function apiError(error: unknown): string {
  return error instanceof Error ? error.message : "Isolated signup test error.";
}

export function setSession(): never {
  throw new Error("Session writes are disabled in the isolated signup keyboard test.");
}

export function getSignupCallCount(): number {
  return signupCalls.length;
}