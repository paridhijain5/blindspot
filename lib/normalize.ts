import { parseDate } from "chrono-node";
import type { Claim } from "@/lib/types";

type ValueType = Claim["valueType"];

function normalizeNumber(value: string): string | undefined {
  const compact = value.replace(/,/g, "").trim();
  const match = compact.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
  if (!match) return undefined;
  const number = Number(match[0]);
  return Number.isFinite(number) ? String(number) : undefined;
}

function normalizeAmount(value: string): string | undefined {
  const multiplierMatch = value.match(/\b(lakh|lac|lakhs|lacs|crore|crores|cr)\b/i);
  const hasThousandSuffix = /(?:\d)\s*k\b/i.test(value);
  const multiplier = multiplierMatch
    ? /^(?:lakh|lac|lakhs|lacs)$/i.test(multiplierMatch[1])
      ? 100_000
      : /^(?:crore|crores|cr)$/i.test(multiplierMatch[1])
        ? 10_000_000
        : 1_000
    : hasThousandSuffix
      ? 1_000
      : 1;
  const number = normalizeNumber(value);
  if (number === undefined) return undefined;
  const amount = Number(number) * multiplier;
  return Number.isFinite(amount) ? String(amount) : undefined;
}

export function normalizeValue(
  valueType: ValueType,
  value: string | null | undefined,
): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();

  if (valueType === "date") {
    const parsed = parseDate(trimmed, new Date(), { forwardDate: false });
    return parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString().slice(0, 10)
      : undefined;
  }

  if (valueType === "amount") return normalizeAmount(trimmed);
  if (valueType === "number") return normalizeNumber(trimmed);
  return trimmed.toLowerCase().replace(/\s+/g, " ").trim();
}
