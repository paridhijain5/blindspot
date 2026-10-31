export function normalizeQuote(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length];
}

function candidateWindows(text: string, quote: string): Set<number> {
  const positions = new Set<number>();
  const gramSize = Math.min(3, quote.length);
  const tolerance = Math.floor(quote.length * 0.1);
  const step = Math.max(1, Math.floor(quote.length / 80));
  const grams = new Set<string>();

  for (let index = 0; index <= quote.length - gramSize; index += step) {
    grams.add(quote.slice(index, index + gramSize));
  }

  for (const gram of grams) {
    let offset = text.indexOf(gram);
    while (offset !== -1) {
      for (let drift = -tolerance; drift <= tolerance; drift += 1) {
        positions.add(Math.max(0, offset - drift));
      }
      if (positions.size > 2000) return positions;
      offset = text.indexOf(gram, offset + 1);
    }
  }
  return positions;
}

export function verifyQuote(sourceText: string, quote: string): boolean {
  const normalizedText = normalizeQuote(sourceText);
  const normalizedQuote = normalizeQuote(quote);
  if (!normalizedQuote) return false;
  if (normalizedText.includes(normalizedQuote)) return true;

  const tolerance = Math.floor(normalizedQuote.length * 0.1);
  if (tolerance === 0) return false;
  const minimumLength = Math.max(1, normalizedQuote.length - tolerance);
  const maximumLength = normalizedQuote.length + tolerance;
  const candidateStarts = candidateWindows(normalizedText, normalizedQuote);
  const maxDistance = Math.floor(normalizedQuote.length * 0.1);

  for (const start of candidateStarts) {
    for (let length = minimumLength; length <= maximumLength; length += 1) {
      const window = normalizedText.slice(start, start + length);
      if (window.length < minimumLength) continue;
      const distance = levenshteinDistance(normalizedQuote, window);
      if (distance <= maxDistance) return true;
    }
  }
  return false;
}
