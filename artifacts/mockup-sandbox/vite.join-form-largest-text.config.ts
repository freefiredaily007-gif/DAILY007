import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sandboxRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const daily007Root = path.resolve(sandboxRoot, "../daily007");
const regressionRoot = path.resolve(sandboxRoot, "src/admin-narrow");
const mock = (name: string) => path.join(regressionRoot, "mocks", name);

export default defineConfig({
  root: sandboxRoot,
  base: "/",
  plugins: [react()],
  optimizeDeps: {
    entries: ["player-join-form-largest-text-preview.html"],
  },
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: mock("react-native-large-text.tsx") },
      { find: /^react-native-web$/, replacement: path.join(daily007Root, "node_modules/react-native-web") },
      { find: /^@expo\/vector-icons$/, replacement: mock("vector-icons.tsx") },
      { find: /^\.\.\/\.\.\/components\/KeyboardAwareScrollViewCompat$/, replacement: mock("keyboard-scroll.tsx") },
    ],
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    strictPort: true,
    allowedHosts: true,
    fs: { allow: [workspaceRoot] },
  },
});
