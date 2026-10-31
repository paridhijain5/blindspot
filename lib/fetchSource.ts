import { createRequire } from "node:module";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "cheerio";
import { Readability } from "@mozilla/readability";
import { PDFParse } from "pdf-parse";
import { JSDOM } from "jsdom";
import { parseDate } from "chrono-node";
import type { Source } from "./types.ts";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_LENGTH = 30_000;
const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
PDFParse.setWorker(
  pathToFileURL(
    nodeRequire.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ).href,
);
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const NEWS_DOMAINS = [
  "bbc.com",
  "bbc.co.uk",
  "theguardian.com",
  "nytimes.com",
  "reuters.com",
  "apnews.com",
  "cnn.com",
  "npr.org",
  "indianexpress.com",
  "thehindu.com",
  "hindustantimes.com",
  "timesofindia.indiatimes.com",
  "ndtv.com",
  "economictimes.indiatimes.com",
  "livemint.com",
  "news18.com",
  "aljazeera.com",
];

class SourceFetchError extends Error {
  readonly isSecurityError: boolean;

  constructor(
    message: string,
    isSecurityError = false,
  ) {
    super(message);
    this.name = "SourceFetchError";
    this.isSecurityError = isSecurityError;
  }
}

function friendlyFetchError(message: string, isPdf: boolean): string {
  if (/private|reserved|internal|localhost/i.test(message)) {
    return "Blocked for safety: this URL points to a local, private, or internal address.";
  }
  if (/credential/i.test(message)) {
    return "Remove any login credentials from the source URL and try again.";
  }
  if (/only http/i.test(message)) {
    return "Use a public HTTP or HTTPS source URL.";
  }
  if (/12\s*mb|download limit|exceeds the/i.test(message)) {
    return isPdf
      ? "This PDF exceeds the 12 MB download limit. Try a smaller PDF or an official HTML page."
      : "This source exceeds the 12 MB download limit.";
  }
  if (/HTTP 401|HTTP 403|blocked automated access|could not access this site/i.test(message)) {
    return "This site blocked automated access. Try a public page or another source.";
  }
  if (/timeout|timed out|aborted/i.test(message)) {
    return "The source did not respond in time. Try again or use another source.";
  }
  return message;
}

function isIPv4Blocked(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isIPv6Blocked(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;

  const mappedIPv4 = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIPv4) return isIPv4Blocked(mappedIPv4[1]);

  const [left, right = ""] = normalized.split("::");
  const leftGroups = left ? left.split(":") : [];
  const rightGroups = right ? right.split(":") : [];
  const missingGroups = 8 - leftGroups.length - rightGroups.length;
  const groups = normalized.includes("::")
    ? [
        ...leftGroups,
        ...Array.from({ length: Math.max(0, missingGroups) }, () => "0"),
        ...rightGroups,
      ]
    : leftGroups;
  const numbers = groups.map((group) => Number.parseInt(group || "0", 16));
  if (
    numbers.length === 8 &&
    numbers.slice(0, 5).every((part) => part === 0) &&
    numbers[5] === 0xffff
  ) {
    const mappedAddress = `${numbers[6] >> 8}.${numbers[6] & 255}.${numbers[7] >> 8}.${numbers[7] & 255}`;
    if (isIPv4Blocked(mappedAddress)) return true;
  }

  const firstGroup = numbers[0] || 0;
  return (
    (firstGroup & 0xe000) !== 0x2000 ||
    (firstGroup & 0xfe00) === 0xfc00 ||
    (firstGroup & 0xffc0) === 0xfe80 ||
    (firstGroup & 0xff00) === 0xff00 ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("100:")
  );
}

function isAddressBlocked(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isIPv4Blocked(address);
  if (family === 6) return isIPv6Blocked(address);
  return true;
}

async function validatePublicURL(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SourceFetchError("The source URL is invalid.", true);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SourceFetchError("Only HTTP and HTTPS source URLs are allowed.", true);
  }
  if (url.username || url.password) {
    throw new SourceFetchError("URLs containing credentials are not allowed.", true);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new SourceFetchError("Local and internal hosts are not allowed.", true);
  }

  if (isIP(hostname)) {
    if (isAddressBlocked(hostname)) {
      throw new SourceFetchError("Private and reserved IP addresses are not allowed.", true);
    }
    return url;
  }

  let addresses: Awaited<ReturnType<typeof lookup>>[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SourceFetchError("The source host could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isAddressBlocked(address))) {
    throw new SourceFetchError("The source host resolves to a private or reserved IP address.", true);
  }

  return url;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function normalizePublishedDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = parseDate(value, new Date(), { forwardDate: false });
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function dateFromText(text: string): string | undefined {
  const patterns =
    /(?:last\s+updated|published|updated\s+on)\s*:?\s*([^\n\r.;]{4,80})/gi;
  for (const match of text.matchAll(patterns)) {
    const date = normalizePublishedDate(match[1]);
    if (date) return date;
  }
  return undefined;
}

function findJSONLDDates(value: unknown): {
  datePublished?: string;
  dateModified?: string;
} {
  if (Array.isArray(value)) {
    return value.reduce(
      (dates, entry) => {
        const found = findJSONLDDates(entry);
        return {
          datePublished: dates.datePublished || found.datePublished,
          dateModified: dates.dateModified || found.dateModified,
        };
      },
      {},
    );
  }

  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const datePublished =
    typeof record.datePublished === "string"
      ? normalizePublishedDate(record.datePublished)
      : undefined;
  const dateModified =
    typeof record.dateModified === "string"
      ? normalizePublishedDate(record.dateModified)
      : undefined;
  const nested = Object.values(record).reduce<{
    datePublished?: string;
    dateModified?: string;
  }>(
    (dates, entry) => {
      const found = findJSONLDDates(entry);
      return {
        datePublished: dates.datePublished || found.datePublished,
        dateModified: dates.dateModified || found.dateModified,
      };
    },
    {} as { datePublished?: string; dateModified?: string },
  );

  return {
    datePublished: datePublished || nested.datePublished,
    dateModified: dateModified || nested.dateModified,
  };
}

function classifyTier(hostname: string): Source["tier"] {
  const domain = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    domain.endsWith(".gov") ||
    domain === "gov" ||
    domain === "gov.in" ||
    domain.endsWith(".gov.in") ||
    domain === "nic.in" ||
    domain.endsWith(".nic.in") ||
    domain === "edu" ||
    domain.endsWith(".edu") ||
    domain === "ac.in" ||
    domain.endsWith(".ac.in") ||
    domain === "org" ||
    domain.endsWith(".org")
  ) {
    return "official";
  }
  if (NEWS_DOMAINS.some((known) => domain === known || domain.endsWith(`.${known}`))) {
    return "news";
  }
  if (
    domain === "medium.com" ||
    domain.endsWith(".medium.com") ||
    domain.endsWith(".blogspot.com") ||
    domain.endsWith(".wordpress.com") ||
    domain === "wordpress.com" ||
    domain === "substack.com" ||
    domain.endsWith(".substack.com")
  ) {
    return "blog";
  }
  return "unknown";
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new SourceFetchError("The source exceeds the 12 MB download limit.");
  }
  if (!response.body) {
    throw new SourceFetchError("The source response had no body.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SourceFetchError("The source exceeds the 12 MB download limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchWithRedirects(input: URL): Promise<{
  response: Response;
  body: Buffer;
  finalURL: URL;
}> {
  let current = input;

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    current = await validatePublicURL(current.href);
    const response = await fetch(current, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/pdf,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SourceFetchError("The source redirected without a destination.");
      }
      if (redirects === 5) {
        throw new SourceFetchError("The source exceeded the redirect limit.");
      }
      current = new URL(location, current);
      await response.body?.cancel();
      continue;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new SourceFetchError(
          `The site blocked automated access (HTTP ${response.status}). Try a public page or another source.`,
        );
      }
      throw new SourceFetchError(`The source returned HTTP ${response.status}.`);
    }

    return { response, body: await readBoundedBody(response), finalURL: current };
  }

  throw new SourceFetchError("The source exceeded the redirect limit.");
}

function htmlMetadata(html: string, pageURL: string): {
  title: string;
  text: string;
  publishedDate?: string;
} {
  const dom = new JSDOM(html, { url: pageURL });
  const document = dom.window.document;
  const title =
    document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
    document.querySelector('meta[name="twitter:title"]')?.getAttribute("content")?.trim() ||
    document.title.trim();
  const metaPublished =
    document
      .querySelector('meta[property="article:published_time"]')
      ?.getAttribute("content") ||
    document.querySelector('meta[name="datePublished"]')?.getAttribute("content");
  const metaUpdated =
    document.querySelector('meta[property="og:updated_time"]')?.getAttribute("content") ||
    document.querySelector('meta[property="article:modified_time"]')?.getAttribute("content");

  let jsonLD: { datePublished?: string; dateModified?: string } = {};
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed: unknown = JSON.parse(script.textContent || "");
      const dates = findJSONLDDates(parsed);
      jsonLD = {
        datePublished: jsonLD.datePublished || dates.datePublished,
        dateModified: jsonLD.dateModified || dates.dateModified,
      };
    } catch {
      continue;
    }
  }

  const article = new Readability(document).parse();
  const fallbackText = load(html)("body").text();
  const text = article?.textContent || fallbackText;
  dom.window.close();

  return {
    title: title || new URL(pageURL).hostname,
    text: normalizeText(text),
    publishedDate:
      normalizePublishedDate(metaPublished) ||
      normalizePublishedDate(metaUpdated) ||
      jsonLD.datePublished ||
      jsonLD.dateModified ||
      undefined,
  };
}

async function extractResponse(
  body: Buffer,
  response: Response,
  pageURL: URL,
  originalURL: URL,
): Promise<{ title: string; text: string; publishedDate?: string; isPdf: boolean }> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  const isPdf =
    contentType.includes("application/pdf") ||
    pageURL.pathname.toLowerCase().endsWith(".pdf") ||
    originalURL.pathname.toLowerCase().endsWith(".pdf") ||
    body.subarray(0, 5).toString("ascii") === "%PDF-";

  if (isPdf) {
    const parser = new PDFParse({ data: body });
    try {
      const textResult = await parser.getText();
      const info = await parser.getInfo();
      const title =
        info.info?.Title?.trim() ||
        pageURL.pathname.split("/").pop() ||
        pageURL.hostname;
      const publishedDate =
        normalizePublishedDate(info.info?.CreationDate) ||
        normalizePublishedDate(info.info?.ModDate);
      return {
        title,
        text: normalizeText(textResult.text),
        publishedDate,
        isPdf: true,
      };
    } finally {
      await parser.destroy();
    }
  }

  const html = body.toString("utf8");
  if (contentType.includes("html") || /^\s*(?:<!doctype html|<html)/i.test(html)) {
    const metadata = htmlMetadata(html, pageURL.href);
    return { ...metadata, isPdf: false };
  }

  const title =
    html.match(/^\s*#\s+(.+)\s*$/m)?.[1]?.trim() ||
    pageURL.pathname.split("/").pop() ||
    pageURL.hostname;
  return {
    title,
    text: normalizeText(html),
    publishedDate: undefined,
    isPdf: false,
  };
}

async function fetchViaJina(
  url: URL,
): Promise<{ title: string; text: string; publishedDate?: string }> {
  const jinaURL = `https://r.jina.ai/${url.href}`;
  const response = await fetch(jinaURL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/plain",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SourceFetchError(
        `The source reader could not access this site (HTTP ${response.status}).`,
      );
    }
    throw new SourceFetchError(`Jina Reader returned HTTP ${response.status}.`);
  }
  const body = await readBoundedBody(response);
  const rawText = body.toString("utf8").replace(/\r\n/g, "\n");
  const markdownContent = rawText.match(/^\s*Markdown Content:\s*([\s\S]*)$/im);
  const content = markdownContent
    ? markdownContent[1]
    : rawText
        .split("\n")
        .filter((line) => !/^\s*(?:Title|URL Source|Published Time|Warning):/i.test(line))
        .join("\n");
  const text = normalizeText(content);
  const titleLine = rawText.match(/^\s*Title:\s*(.+)$/im)?.[1];
  const publishedText = rawText.match(
    /Published Time:\s*(.+?)(?:\s+Warning:|$)/i,
  )?.[1];
  const title =
    titleLine?.replace(/\s+Published Time:.*$/i, "").trim() ||
    text.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() ||
    url.pathname.split("/").pop() ||
    url.hostname;
  const publishedDate = normalizePublishedDate(publishedText);
  return {
    title,
    text,
    ...(publishedDate ? { publishedDate } : {}),
  };
}

export async function fetchSource(input: string): Promise<Source> {
  const fetchedAt = new Date().toISOString();
  let url: URL | undefined;
  let title = input;
  let text = "";
  let publishedDate: string | undefined;
  let isPdf = false;
  let retrievalMethod: Source["retrievalMethod"] = "direct";

  try {
    url = await validatePublicURL(input);
    title = url.hostname;
  } catch (error) {
    return {
      id: randomUUID(),
      url: input,
      title,
      text,
      fetchedAt,
      retrievalMethod,
      tier: "unknown",
      isPdf,
      error: friendlyFetchError(
        error instanceof Error ? error.message : "The source URL is invalid.",
        false,
      ),
    };
  }
  isPdf = url.pathname.toLowerCase().endsWith(".pdf");

  let directError: unknown;
  try {
    const direct = await fetchWithRedirects(url);
    const directContent = await extractResponse(
      direct.body,
      direct.response,
      direct.finalURL,
      url,
    );
    title = directContent.title;
    text = directContent.text;
    publishedDate =
      directContent.publishedDate ||
      normalizePublishedDate(direct.response.headers.get("last-modified")) ||
      dateFromText(text);
    isPdf = directContent.isPdf;
  } catch (error) {
    if (error instanceof SourceFetchError && error.isSecurityError) {
      return {
        id: randomUUID(),
        url: input,
        title,
        text: "",
        fetchedAt,
        retrievalMethod,
        tier: classifyTier(url.hostname),
        isPdf,
        error: friendlyFetchError(error.message, isPdf),
      };
    }
    directError = error;
  }

  if (directError || text.length < 200) {
    try {
      retrievalMethod = "jina";
      const fallback = await fetchViaJina(url);
      if (fallback.text.length >= text.length) {
        title = fallback.title || title;
        text = fallback.text;
      }
      publishedDate ||= fallback.publishedDate || dateFromText(text);
      isPdf ||= url.pathname.toLowerCase().endsWith(".pdf");
    } catch (fallbackError) {
      const directMessage =
        directError instanceof Error ? directError.message : undefined;
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : "Jina Reader failed.";
      const message = directMessage
        ? `${directMessage} Jina fallback failed: ${fallbackMessage}`
        : fallbackMessage;
      if (text.length < 200) {
        return {
          id: randomUUID(),
          url: input,
          title,
          text,
          fetchedAt,
          retrievalMethod,
          tier: classifyTier(url.hostname),
          isPdf,
          ...(publishedDate ? { publishedDate } : {}),
          error: friendlyFetchError(message, isPdf),
        };
      }
    }
  }

  if (text.length < 200) {
    return {
      id: randomUUID(),
      url: input,
      title,
      text,
      fetchedAt,
      retrievalMethod,
      tier: url ? classifyTier(url.hostname) : "unknown",
      isPdf,
      ...(publishedDate ? { publishedDate } : {}),
      error: directError
        ? friendlyFetchError(
            directError instanceof Error
              ? directError.message
              : "The source could not be read.",
            isPdf,
          )
        : "The source contained fewer than 200 characters after retrieval.",
    };
  }

  return {
    id: randomUUID(),
    url: input,
    title,
    text: normalizeText(text),
    fetchedAt,
    retrievalMethod,
    tier: url ? classifyTier(url.hostname) : "unknown",
    isPdf,
    ...(publishedDate ? { publishedDate } : {}),
  };
}
