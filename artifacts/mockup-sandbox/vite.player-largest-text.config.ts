import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sandboxRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const daily007Root = path.resolve(sandboxRoot, "../daily007");
const regressionRoot = path.resolve(sandboxRoot, "src/admin-narrow");
const port = Number(process.env.PORT ?? 4192);

const mock = (name: string) => path.join(regressionRoot, "mocks", name);

export default defineConfig({
  root: sandboxRoot,
  base: "/",
  plugins: [react()],
  optimizeDeps: {
    entries: ["player-largest-text-preview.html"],
  },
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: mock("react-native-large-text.tsx") },
      { find: /^react-native-web$/, replacement: path.join(daily007Root, "node_modules/react-native-web") },
      { find: /^@\//, replacement: `${daily007Root}/` },
      { find: /^@expo\/vector-icons$/, replacement: mock("vector-icons.tsx") },
      { find: /^@workspace\/api-client-react$/, replacement: mock("api-client-react.ts") },
      { find: /^@react-navigation\/native$/, replacement: mock("navigation.ts") },
      { find: /^\.\.\/lib\/api$/, replacement: mock("api.ts") },
      { find: /^\.\.\/App$/, replacement: mock("app.ts") },
      { find: /^\.\.\/components\/KeyboardAwareScrollViewCompat$/, replacement: mock("keyboard-scroll.tsx") },
      { find: /^\.\.\/\.\.\/components\/KeyboardAwareScrollViewCompat$/, replacement: mock("keyboard-scroll.tsx") },
      { find: /^expo-image-picker$/, replacement: mock("image-picker.ts") },
      { find: /^expo-file-system$/, replacement: mock("file-system.ts") },
      { find: /^expo-sharing$/, replacement: mock("sharing.ts") },
      { find: /^expo-clipboard$/, replacement: mock("clipboard.ts") },
      { find: /^expo-web-browser$/, replacement: mock("web-browser.ts") },
      { find: /^react-native-webview$/, replacement: mock("webview.tsx") },
      { find: /^\.\.\/lib\/walletImages$/, replacement: mock("wallet-images.ts") },
      { find: /^\.\.\/components\/GoogleSSOButton$/, replacement: mock("google-sso.tsx") },
      { find: /^\.\.\/components\/SocialIcons$/, replacement: mock("social-icons.tsx") },
    ],
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    allowedHosts: true,
    fs: { allow: [workspaceRoot] },
  },
});