import { useEffect } from "react";

export function useFocusEffect(effect: () => void | (() => void)) {
  useEffect(effect, [effect]);
}

export function useNavigation() {
  return {
    navigate: (...args: unknown[]) => {
      const preview = globalThis as typeof globalThis & { __previewNavigations?: unknown[][] };
      preview.__previewNavigations ??= [];
      preview.__previewNavigations.push(args);
    },
  };
}

export function useRoute() {
  return { params: {} };
}