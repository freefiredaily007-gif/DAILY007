import { useEffect } from "react";

export function useFocusEffect(effect: () => void | (() => void)) {
  useEffect(effect, [effect]);
}

export function useNavigation() {
  return { navigate: () => undefined };
}

export function useRoute() {
  return { params: {} };
}