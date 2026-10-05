import React, { useEffect, useState } from "react";

type ScreenProps = {
  name: string;
  component: React.ComponentType<any>;
  options?: { tabBarLabel?: string };
};

type NavigatorProps = {
  children: React.ReactNode;
  initialRouteName?: string;
};

export const DarkTheme = { colors: {} };

export function NavigationContainer({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useFocusEffect(effect: React.EffectCallback) {
  useEffect(effect, [effect]);
}

export function useNavigation() {
  return { navigate: () => undefined, goBack: () => undefined };
}

export function useRoute() {
  return { params: {} };
}

function collectScreens(
  children: React.ReactNode,
  Screen: React.ComponentType<ScreenProps>,
  collected: React.ReactElement<ScreenProps>[] = [],
) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const element = child as React.ReactElement<{ children?: React.ReactNode }>;
    if (element.type === React.Fragment) {
      collectScreens(element.props.children, Screen, collected);
    } else if (element.type === Screen) {
      collected.push(element as React.ReactElement<ScreenProps>);
    }
  });
  return collected;
}

function makeNavigator(kind: "stack" | "tabs") {
  const Screen = (_props: ScreenProps) => null;
  Screen.displayName = kind === "tabs" ? "MockTabScreen" : "MockStackScreen";

  function Navigator({ children, initialRouteName }: NavigatorProps) {
    const screens = collectScreens(children, Screen);
    const [activeRoute, setActiveRoute] = useState(
      initialRouteName ?? screens[0]?.props.name ?? "",
    );
    const active = screens.find((screen) => screen.props.name === activeRoute) ?? screens[0];
    if (!active) return null;
    const ActiveScreen = active.props.component;

    if (kind === "stack") return <ActiveScreen />;

    return (
      <div data-testid="mock-player-tabs">
        <nav aria-label="Daily007 player tabs">
          {screens.map((screen) => (
            <button
              key={screen.props.name}
              type="button"
              data-testid={`mock-tab-${screen.props.name.toLowerCase()}`}
              aria-current={screen.props.name === activeRoute ? "page" : undefined}
              onClick={() => setActiveRoute(screen.props.name)}
            >
              {screen.props.options?.tabBarLabel ?? screen.props.name}
            </button>
          ))}
        </nav>
        <ActiveScreen />
      </div>
    );
  }

  return { Navigator, Screen };
}

export function createNativeStackNavigator() {
  return makeNavigator("stack");
}

export function createBottomTabNavigator() {
  return makeNavigator("tabs");
}
