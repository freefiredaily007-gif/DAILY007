import React from "react";
import { createRoot } from "react-dom/client";

const localAsset = () => ({ uri: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
globalThis.require = localAsset;
window.require = localAsset;
window.alert = () => undefined;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Signup keyboard preview root is missing.");

const root = createRoot(rootElement);

void (async () => {
  const [{ default: Auth }, apiMocks] = await Promise.all([
    import("../../../daily007/src/screens/Auth"),
    import("./mocks/signup-auth-api.ts"),
  ]);

  window.__daily007SignupKeyboardTest = {
    ready: true,
    getRegisterCalls: apiMocks.getSignupCallCount,
  };
  root.render(React.createElement(Auth, { onDone: () => undefined }));
})();