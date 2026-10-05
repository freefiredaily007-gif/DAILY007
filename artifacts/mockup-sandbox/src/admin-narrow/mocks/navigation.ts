import { useEffect } from "react";

export function useFocusEffect(effect: () => void | (() => void)) {
  useEffect(effect, [effect]);
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

export function useRoute() {
  return { params: {} };
}