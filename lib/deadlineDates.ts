import { parse as parseDates } from "chrono-node";

export type ParsedDeadlineDate = {
  date: string;
  text: string;
  index: number;
};

function isApplicationDeadlineContext(
  text: string,
  dateIndex: number,
  dateLength: number,
): boolean {
  const context = text.slice(
    Math.max(0, dateIndex - 180),
    Math.min(text.length, dateIndex + dateLength + 180),
  );
  const preceding = text.slice(Math.max(0, dateIndex - 80), dateIndex);
  const dateText = text.slice(dateIndex, dateIndex + dateLength);

  if (
    /\b(?:checked|published|updated)\s+on\s*$/i.test(preceding) ||
    (/^on\s+/i.test(dateText) &&
      /\b(?:checked|published|updated)\s*$/i.test(preceding)) ||
    /\b(?:portal|registration|applications?)\s+(?:is\s+)?open\b/i.test(
      preceding,
    ) ||
    /\b(?:verification|defective|institute|district|state)\b.{0,80}\b(?:deadline|date)\b/i.test(
      preceding,
    )
  ) {
    return false;
  }

  return /\b(?:last date|closing dates?|deadline|applications? close(?:d|s)?)\b/i.test(
    context,
  );
}

export function parseApplicationDeadlineDates(
  text: string,
  referenceDate = new Date(),
): ParsedDeadlineDate[] {
  const dates: ParsedDeadlineDate[] = [];
  const seen = new Set<string>();

  for (const parsed of parseDates(text, referenceDate, {
    forwardDate: false,
  })) {
    if (
      !parsed.start.isCertain("year") ||
      !parsed.start.isCertain("month") ||
      !parsed.start.isCertain("day") ||
      !isApplicationDeadlineContext(text, parsed.index, parsed.text.length)
    ) {
      continue;
    }

    const date = parsed.start.date().toISOString().slice(0, 10);
    if (seen.has(date)) continue;
    seen.add(date);
    dates.push({ date, text: parsed.text, index: parsed.index });
  }
  return dates;
}
