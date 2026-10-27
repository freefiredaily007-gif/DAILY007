import React from "react";

type IconProps = {
  name?: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
};

export function Feather({ name, size = 16, color, style }: IconProps) {
  return (
    <span
      aria-hidden="true"
      data-preview-icon={name}
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size,
        height: size,
        color,
        ...style,
      }}
    />
  );
}

export function FontAwesome({ name, size = 16, color, style }: IconProps) {
  return (
    <span
      aria-hidden="true"
      data-preview-icon={name}
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size,
        height: size,
        color,
        ...style,
      }}
    />
  );
}

export function Ionicons({ name, size = 16, color, style }: IconProps) {
  return (
    <span
      aria-hidden="true"
      data-preview-icon={name}
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size,
        height: size,
        color,
        ...style,
      }}
    />
  );
}

export function FontAwesome5({ name, size = 16, color, style }: IconProps) {
  return (
    <span
      aria-hidden="true"
      data-preview-icon={name}
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size,
        height: size,
        color,
        ...style,
      }}
    />
  );
}

(Feather as typeof Feather & { glyphMap: Record<string, number> }).glyphMap = {};
(FontAwesome as typeof FontAwesome & { glyphMap: Record<string, number> }).glyphMap = {};
(Ionicons as typeof Ionicons & { glyphMap: Record<string, number> }).glyphMap = {};
(FontAwesome5 as typeof FontAwesome5 & { glyphMap: Record<string, number> }).glyphMap = {};