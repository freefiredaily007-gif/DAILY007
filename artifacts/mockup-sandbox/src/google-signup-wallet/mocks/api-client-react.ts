// Reuse the complete app API mock surface for screens in App's import graph.
// The local auth and password mocks below retain precedence for this preview.
export * from "../../admin-narrow/mocks/api-client-react";

export function setBaseUrl() {
  return undefined;
}

export function setAuthExpiredHandler() {
  return undefined;
}

export function useDaily007ChangePassword() {
  return { mutateAsync: async () => undefined, isPending: false };
}
