import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sandboxRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const daily007Root = path.resolve(sandboxRoot, "../daily007");
const regressionRoot = path.resolve(sandboxRoot, "src/admin-narrow");
const port = Number(process.env.PORT ?? 4192);

export default defineConfig({
  root: sandboxRoot,
  base: "/",
  plugins: [react()],
  optimizeDeps: {
    entries: ["signup-keyboard-preview.html"],
    esbuildOptions: {
      resolveExtensions: [
        ".web.tsx",
        ".web.ts",
        ".web.jsx",
        ".web.js",
        ".mjs",
        ".js",
        ".mts",
        ".ts",
        ".jsx",
        ".tsx",
        ".json",
        ".cjs",
        ".cts",
      ],
    },
  },
  resolve: {
    extensions: [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ".mjs",
      ".js",
      ".mts",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
      ".cjs",
      ".cts",
    ],
    alias: [
      { find: /^react-native$/, replacement: path.join(daily007Root, "node_modules/react-native-web") },
      { find: /^expo-router$/, replacement: path.join(regressionRoot, "mocks/expo-router.tsx") },
      { find: /^@expo\/vector-icons$/, replacement: path.join(regressionRoot, "mocks/vector-icons.tsx") },
      { find: /^react-native-keyboard-controller$/, replacement: path.join(regressionRoot, "mocks/keyboard-controller.tsx") },
      { find: /^\.\.\/lib\/api$/, replacement: path.join(regressionRoot, "mocks/signup-auth-api.ts") },
      { find: /^\.\.\/components\/GoogleSSOButton$/, replacement: path.join(regressionRoot, "mocks/google-sso.tsx") },
      { find: /^\.\/TimePicker$/, replacement: path.join(regressionRoot, "mocks/signup-time-picker.tsx") },
    ],
    dedupe: ["react", "react-dom"],
  },
  define: {
    __DEV__: JSON.stringify(true),
    "process.env.EXPO_PUBLIC_DOMAIN": JSON.stringify(""),
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    allowedHosts: true,
    fs: { allow: [workspaceRoot] },
  },
});
