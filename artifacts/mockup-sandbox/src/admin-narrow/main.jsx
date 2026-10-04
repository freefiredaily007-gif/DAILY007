import React from "react";
import { createRoot } from "react-dom/client";

const localAsset = () => 0;
globalThis.require = localAsset;
window.require = localAsset;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Admin narrow-screen preview root is missing.");

const root = createRoot(rootElement);
void import("../../../daily007/src/screens/AdminApp").then(({ default: AdminApp }) => {
  root.render(<AdminApp onLogout={() => undefined} />);
});