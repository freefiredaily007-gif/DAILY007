import React from "react";
import { createRoot } from "react-dom/client";

const localAsset = () => 0;
globalThis.require = localAsset;
window.require = localAsset;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Instagram claim preview root is missing.");

void (async () => {
  const [{ default: AdminEarnTasks }, { AdminUiProvider }, { AdminToastHost }] = await Promise.all([
    import("../../../daily007/src/screens/AdminEarnTasks"),
    import("../../../daily007/src/components/ui"),
    import("../../../daily007/src/components/adminKit"),
  ]);
  createRoot(rootElement).render(
    <AdminUiProvider>
      <AdminToastHost>
        <AdminEarnTasks />
      </AdminToastHost>
    </AdminUiProvider>,
  );
})();
