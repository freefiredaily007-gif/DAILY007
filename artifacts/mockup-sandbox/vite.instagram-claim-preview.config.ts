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
  define: {
    __DEV__: JSON.stringify(true),
  },
  optimizeDeps: {
    entries: ["instagram-claim-preview.html"],
  },
  resolve: {
    alias: [
      { find: /^react-native-web$/, replacement: path.join(daily007Root, "node_modules/react-native-web") },
      { find: /^react-native$/, replacement: path.join(regressionRoot, "mocks/react-native-large-text.tsx") },
      { find: /^expo-network$/, replacement: path.join(regressionRoot, "mocks/network.ts") },
      { find: /^@expo\/vector-icons$/, replacement: path.join(regressionRoot, "mocks/vector-icons.tsx") },
      { find: /^@workspace\/api-client-react$/, replacement: path.join(regressionRoot, "mocks/api-client-react.ts") },
      { find: /^@react-navigation\/native$/, replacement: path.join(regressionRoot, "mocks/navigation.ts") },
      { find: /^\.\.\/lib\/api$/, replacement: path.join(regressionRoot, "mocks/api.ts") },
      { find: /^\.\.\/App$/, replacement: path.join(regressionRoot, "mocks/app.ts") },
      {
        find: /^\.\.\/components\/KeyboardAwareScrollViewCompat$/,
        replacement: path.join(regressionRoot, "mocks/keyboard-scroll.tsx"),
      },
      {
        find: /^\.\.\/\.\.\/components\/KeyboardAwareScrollViewCompat$/,
        replacement: path.join(regressionRoot, "mocks/keyboard-scroll.tsx"),
      },
      { find: /^expo-image-picker$/, replacement: path.join(regressionRoot, "mocks/image-picker.ts") },
      { find: /^expo-file-system$/, replacement: path.join(regressionRoot, "mocks/file-system.ts") },
      { find: /^expo-sharing$/, replacement: path.join(regressionRoot, "mocks/sharing.ts") },
      { find: /^expo-clipboard$/, replacement: path.join(regressionRoot, "mocks/clipboard.ts") },
      { find: /^\.\.\/lib\/walletImages$/, replacement: path.join(regressionRoot, "mocks/wallet-images.ts") },
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
