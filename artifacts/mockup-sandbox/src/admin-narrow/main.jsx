import React from "react";
import { createRoot } from "react-dom/client";

const localAsset = () => 0;
globalThis.require = localAsset;
window.require = localAsset;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Admin narrow-screen preview root is missing.");

const root = createRoot(rootElement);
void (async () => {
  const previewParams = new URLSearchParams(window.location.search);
  if (previewParams.get("admin-tournament-empty-filter") === "1") {
    const { configureAdminTournamentEmptyFilterPreview } = await import("./mocks/api.ts");
    configureAdminTournamentEmptyFilterPreview();
  }
  const { default: AdminApp } = await import("../../../daily007/src/screens/AdminApp");
  root.render(<AdminApp onLogout={() => undefined} />);
})();