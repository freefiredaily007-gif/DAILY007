const previewUser = {
  id: "preview-player",
  name: "Preview Player",
  phone: "",
  gameUid: "",
  coins: 1000,
  role: "full_admin",
};

const previewRefresh = async () => ({ user: previewUser });
const previewLogout = () => undefined;

export function useApp() {
  return { user: previewUser, refresh: previewRefresh, logout: previewLogout };
}
