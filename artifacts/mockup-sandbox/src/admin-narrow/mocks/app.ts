export function useApp() {
  return {
    user: {
      id: "preview-player",
      name: "Preview Player",
      coins: 1000,
      role: "full_admin",
    },
    logout: () => undefined,
  };
}