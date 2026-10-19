import React from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";

const localAsset = () => ({ uri: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
globalThis.require = localAsset;
globalThis.global = globalThis;
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
  root.render(
    React.createElement(
      SafeAreaProvider,
      {
        initialMetrics: {
          frame: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      },
      React.createElement(Auth, { onDone: () => undefined }),
    ),
  );
})();