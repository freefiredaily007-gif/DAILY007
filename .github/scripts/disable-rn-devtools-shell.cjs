"use strict";

const Module = require("node:module");

function installCiDevToolsShellOverride(moduleLoader, isCi) {
  if (!isCi) return false;

  const originalLoad = moduleLoader._load;
  moduleLoader._load = function loadWithCiDevToolsOverride(request, parent, isMain) {
    const loaded = originalLoad.call(this, request, parent, isMain);
    if (
      request !== "@react-native/dev-middleware" ||
      !loaded ||
      typeof loaded.createDevMiddleware !== "function"
    ) {
      return loaded;
    }

    return new Proxy(loaded, {
      get(target, property, receiver) {
        const exported = Reflect.get(target, property, receiver);
        if (property !== "createDevMiddleware" || typeof exported !== "function") {
          return exported;
        }

        return function createCiDevMiddleware(options, ...args) {
          return exported.call(this, {
            ...options,
            unstable_experiments: {
              ...options?.unstable_experiments,
              enableStandaloneFuseboxShell: false,
            },
          }, ...args);
        };
      },
    });
  };

  return true;
}

installCiDevToolsShellOverride(Module, process.env.CI === "1");

module.exports = { installCiDevToolsShellOverride };
