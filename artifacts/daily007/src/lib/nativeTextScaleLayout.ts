import type {
  LayoutChangeEvent,
  NativeSyntheticEvent,
  TextLayoutEventData,
} from 'react-native';

export type NativeTextScaleLayout = {
  width?: number;
  lineWidths?: number[];
};

export type NativeTextScaleLayoutObserver = (
  key: string,
  update: NativeTextScaleLayout,
) => void;

export function mergeNativeTextScaleLayout(
  layouts: Record<string, NativeTextScaleLayout>,
  key: string,
  update: NativeTextScaleLayout,
): Record<string, NativeTextScaleLayout> {
  const previous = layouts[key];
  const next = { ...previous, ...update };
  const sameLines = previous?.lineWidths?.length === next.lineWidths?.length
    && (previous?.lineWidths ?? []).every((width, index) => width === next.lineWidths?.[index]);
  if (previous?.width === next.width && sameLines) return layouts;
  return { ...layouts, [key]: next };
}

export function nativeTextScaleTextProps(
  key: string,
  observe?: NativeTextScaleLayoutObserver,
) {
  if (!observe) return {};
  return {
    onLayout: (event: LayoutChangeEvent) => {
      observe(key, { width: event.nativeEvent.layout.width });
    },
    onTextLayout: (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      observe(key, {
        lineWidths: event.nativeEvent.lines.map((line) => line.width),
      });
    },
  };
}

export function nativeTextScaleLayoutsFit(
  layouts: Record<string, NativeTextScaleLayout>,
  requiredKeys: readonly string[],
): boolean {
  return requiredKeys.every((key) => {
    const layout = layouts[key];
    const availableWidth = layout?.width;
    return typeof availableWidth === 'number'
      && availableWidth > 0
      && Array.isArray(layout.lineWidths)
      && layout.lineWidths.length > 0
      && layout.lineWidths.every((lineWidth) =>
        Number.isFinite(lineWidth) && lineWidth <= availableWidth + 1,
      );
  });
}
