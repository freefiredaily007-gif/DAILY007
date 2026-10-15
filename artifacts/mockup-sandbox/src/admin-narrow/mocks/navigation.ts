import { useEffect } from "react";

type PreviewFocusEntry = {
  effect: () => void | (() => void);
  cleanup?: () => void;
};
const previewFocusEntries = new Set<PreviewFocusEntry>();

function registerPreviewFocusEffect(effect: () => void | (() => void)) {
  const entry: PreviewFocusEntry = { effect, cleanup: effect() || undefined };
  previewFocusEntries.add(entry);
  return () => {
    entry.cleanup?.();
    previewFocusEntries.delete(entry);
  };
}

function triggerPreviewFocusCycle() {
  for (const entry of previewFocusEntries) {
    entry.cleanup?.();
    entry.cleanup = entry.effect() || undefined;
  }
}

function blurPreviewFocus() {
  for (const entry of previewFocusEntries) {
    entry.cleanup?.();
    entry.cleanup = undefined;
  }
}

function focusPreview() {
  for (const entry of previewFocusEntries) {
    if (!entry.cleanup) entry.cleanup = entry.effect() || undefined;
  }
}

export function useFocusEffect(effect: () => void | (() => void)) {
  const focusLifecyclePreview = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("resume-while-refresh-only");
  useEffect(() => {
    if (!focusLifecyclePreview) return effect();
    const preview = globalThis as typeof globalThis & {
      __daily007PreviewFocusController?: {
        register: (callback: () => void | (() => void)) => () => void;
        triggerFocusCycle: () => void;
        blur: () => void;
        focus: () => void;
      };
    };
    preview.__daily007PreviewFocusController ??= {
      register: registerPreviewFocusEffect,
      triggerFocusCycle: triggerPreviewFocusCycle,
      blur: blurPreviewFocus,
      focus: focusPreview,
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