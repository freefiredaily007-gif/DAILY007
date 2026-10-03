export type OptionalHttpsImageUrlResult =
  | { ok: true; value: string | null }
  | { ok: false };

export function parseOptionalHttpsImageUrl(value: unknown): OptionalHttpsImageUrlResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };

  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > 2048) return { ok: false };

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      return { ok: false };
    }
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false };
  }
}