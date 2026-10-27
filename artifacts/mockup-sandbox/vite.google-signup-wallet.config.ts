import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { previewDependencyBoundaryPlugin } from "./scripts/previewDependencyBoundary.mjs";

const sandboxRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const daily007Root = path.resolve(sandboxRoot, "../daily007");
const previewRoot = path.join(sandboxRoot, "src/google-signup-wallet");
const mocks = (name: string) => path.join(previewRoot, "mocks", name);
const port = Number(process.env.PORT ?? 4193);

export default defineConfig({
  root: sandboxRoot,
  base: "/",
  plugins: [previewDependencyBoundaryPlugin(), react()],
  define: {
    __DEV__: JSON.stringify(true),
    global: "globalThis",
    "process.env.EXPO_OS": JSON.stringify("web"),
    "process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY": JSON.stringify("pk_test_daily007_mock"),
    "process.env.EXPO_PUBLIC_DOMAIN": JSON.stringify("daily007-test.example.invalid"),
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
  optimizeDeps: {
    entries: ["google-signup-wallet-preview.html"],
    esbuildOptions: {
      resolveExtensions: [
        ".web.mjs",
        ".mjs",
        ".web.js",
        ".js",
        ".web.mts",
        ".mts",
        ".web.ts",
        ".ts",
        ".web.jsx",
        ".jsx",
        ".web.tsx",
        ".tsx",
        ".json",
      ],
    },
  },
  resolve: {
    extensions: [
      ".web.mjs",
      ".mjs",
      ".web.js",
      ".js",
      ".web.mts",
      ".mts",
      ".web.ts",
      ".ts",
      ".web.jsx",
      ".jsx",
      ".web.tsx",
      ".tsx",
      ".json",
    ],
    alias: [
      { find: /^react-native$/, replacement: path.join(daily007Root, "node_modules/react-native-web") },
      { find: /^react-native-web$/, replacement: path.join(daily007Root, "node_modules/react-native-web") },
      { find: /^@expo\/vector-icons$/, replacement: path.join(sandboxRoot, "src/admin-narrow/mocks/vector-icons.tsx") },
      { find: /^@workspace\/api-client-react$/, replacement: mocks("api-client-react.ts") },
      { find: /^@react-navigation\/native$/, replacement: mocks("navigation.tsx") },
      { find: /^@react-navigation\/native-stack$/, replacement: mocks("navigation.tsx") },
      { find: /^@react-navigation\/bottom-tabs$/, replacement: mocks("navigation.tsx") },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: mocks("async-storage.ts") },
      { find: /^expo-router$/, replacement: mocks("expo-router.tsx") },
      { find: /^@clerk\/expo$/, replacement: mocks("clerk-expo.ts") },
      { find: /^expo-auth-session$/, replacement: mocks("auth-session.ts") },
      { find: /^expo-web-browser$/, replacement: mocks("web-browser.ts") },
      { find: /^expo-constants$/, replacement: mocks("expo-constants.ts") },
      { find: /^expo-application$/, replacement: mocks("expo-application.ts") },
      { find: /^expo-network$/, replacement: mocks("network.ts") },
      { find: /^expo-image-picker$/, replacement: path.join(sandboxRoot, "src/admin-narrow/mocks/image-picker.ts") },
      { find: /^expo-clipboard$/, replacement: path.join(sandboxRoot, "src/admin-narrow/mocks/clipboard.ts") },
      { find: /^\.\.\/lib\/walletImages$/, replacement: path.join(sandboxRoot, "src/admin-narrow/mocks/wallet-images.ts") },
      {
        find: /^\.\/screens\/(Home|ModeSubmodes|Video|Earn|Tournaments|TDetail|JoinForm|MyMatches|Leaderboard|LeaderboardDetails|Notifications|EditProfile|AdminApp)$/,
        replacement: mocks("empty-screen.tsx"),
      },
      {
        find: /^\.\.\/components\/KeyboardAwareScrollViewCompat$/,
        replacement: path.join(sandboxRoot, "src/admin-narrow/mocks/keyboard-scroll.tsx"),
      },
      {
        find: /^\.\.\/\.\.\/components\/KeyboardAwareScrollViewCompat$/,
        replacement: path.join(sandboxRoot, "src/admin-narrow/mocks/keyboard-scroll.tsx"),
      },
      { find: /^@\/(.*)$/, replacement: `${daily007Root}/$1` },
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
