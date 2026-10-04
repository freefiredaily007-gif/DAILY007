import React from "react";
import { createRoot } from "react-dom/client";

const localAsset = () => ({ uri: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
globalThis.require = localAsset;
window.require = localAsset;
window.alert = () => undefined;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Keyboard form preview root is missing.");

const root = createRoot(rootElement);

void (async () => {
  const apiMocks = await import("./mocks/api.ts");
  apiMocks.configureWalletFormPreview();
  const [{ default: Wallet }, { default: EditProfile }] = await Promise.all([
    import("../../../daily007/src/screens/Wallet"),
    import("../../../daily007/src/screens/EditProfile"),
  ]);

  window.__daily007KeyboardForms = {
    ready: true,
    showWallet: () => root.render(React.createElement(Wallet)),
    showProfile: () => root.render(React.createElement(EditProfile)),
    getCalls: () => apiMocks.walletPreviewCalls,
  };
  root.render(React.createElement(Wallet));
})();