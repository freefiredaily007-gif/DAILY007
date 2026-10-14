const signupCalls: unknown[] = [];

export class SessionPersistenceError extends Error {
  constructor() {
    super("Daily007 could not save your session on this device. Check available storage and try again.");
    this.name = "SessionPersistenceError";
  }
}

export class LoginRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "LoginRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

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
  throw new SessionPersistenceError();
}

export function getSignupCallCount(): number {
  return signupCalls.length;
}