import { useEffect } from "react";

export function useFocusEffect(effect: () => void | (() => void)) {
  const focusLifecyclePreview = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("resume-while-refresh-only");
  useEffect(() => {
    if (!focusLifecyclePreview) return effect();
    const preview = globalThis as typeof globalThis & {
      __daily007PreviewFocusController?: {
        register: (callback: () => void | (() => void)) => () => void;
      };
    };
    return preview.__daily007PreviewFocusController?.register(effect) ?? effect();
  }, [effect, focusLifecyclePreview]);
}

export function useNavigation() {
  const recordNavigation = (...args: unknown[]) => {
    const preview = globalThis as typeof globalThis & { __previewNavigations?: unknown[][] };
    preview.__previewNavigations ??= [];
    preview.__previewNavigations.push(args);
  };
  return {
    navigate: recordNavigation,
    getParent: () => ({ push: recordNavigation }),
  };
}

export function useIsFocused() {
  return true;
}

export function useRoute() {
  const preview = globalThis as typeof globalThis & {
    __previewRouteParams?: Record<string, unknown>;
  };
  return { params: preview.__previewRouteParams ?? {} };
}