import { formatUnits } from "viem";

export function formatTokenAmount(amount: bigint, decimals = 18): string {
  const n = Number(formatUnits(amount, decimals));
  if (n >= 1) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return formatUnits(amount, decimals);
}

export function formatToken(amount: bigint, decimals = 18, symbol = "WPT"): string {
  return `${formatTokenAmount(amount, decimals)} ${symbol}`;
}

/** Today's date in local timezone as YYYY-MM-DD (for date inputs). */
export function todayIsoDateLocal(date = new Date()): string {
  return isoDateLocalFromDate(date);
}

export function isoDateLocalFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Tomorrow in local timezone as YYYY-MM-DD. */
export function tomorrowIsoDateLocal(date = new Date()): string {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return isoDateLocalFromDate(next);
}

export function addDaysIsoDateLocal(iso: string, days: number): string {
  const [y, m, day] = iso.split("-").map(Number);
  const next = new Date(y, m - 1, day);
  next.setDate(next.getDate() + days);
  return isoDateLocalFromDate(next);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve relative coverage dates ("tomorrow", "today") to YYYY-MM-DD.
 * Pass userText to override a wrong model-generated ISO date when the user
 * asked for a relative day.
 */
export function resolveCoverageDate(
  date: string,
  options?: { reference?: Date; userText?: string },
): string {
  const reference = options?.reference ?? new Date();
  const trimmed = date.trim();
  const lower = trimmed.toLowerCase();
  const today = todayIsoDateLocal(reference);
  const userText = options?.userText?.toLowerCase() ?? "";

  if (/\btomorrow\b/.test(userText)) {
    return tomorrowIsoDateLocal(reference);
  }
  if (/\btoday\b/.test(userText)) {
    return today;
  }

  const isoInUserText = userText.match(/\d{4}-\d{2}-\d{2}/);
  if (isoInUserText) {
    return isoInUserText[0];
  }

  if (ISO_DATE_RE.test(trimmed)) {
    return trimmed;
  }

  if (lower === "today") return today;
  if (lower === "tomorrow") return tomorrowIsoDateLocal(reference);
  if (lower === "day after tomorrow" || lower === "day-after-tomorrow") {
    return addDaysIsoDateLocal(today, 2);
  }

  const inDays = /^in\s+(\d+)\s+days?$/.exec(lower);
  if (inDays) {
    return addDaysIsoDateLocal(today, Number(inDays[1]));
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return isoDateLocalFromDate(new Date(parsed));
  }

  return trimmed;
}

export function formatMmE2(mmE2: bigint): string {
  const mm = Number(mmE2) / 100;
  return `${mm.toFixed(2)} mm`;
}

/** Format on-chain mm×100 from gateway/tool JSON (string or number). */
export function formatMmE2FromUnknown(value: unknown): string | null {
  if (typeof value === "bigint") {
    return formatMmE2(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return formatMmE2(BigInt(trimmed));
    }
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return formatMmE2(BigInt(Math.trunc(value)));
  }
  return null;
}

/** Parse a user-facing rainfall amount (e.g. "1.5") into on-chain mm × 100. */
export function parseMmToMmE2(mm: string): bigint {
  const trimmed = mm.trim();
  if (!trimmed) return 0n;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(trimmed);
  if (!match) return 0n;
  const frac = (match[2] ?? "").padEnd(2, "0").slice(0, 2);
  return BigInt(match[1]) * 100n + BigInt(frac);
}

export function shortenAddress(addr: string, chars = 4): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

/** Tx hash: first and last `chars` hex digits (e.g. 0x1234…abcd). */
export function shortenHash(hash: string, chars = 4): string {
  return shortenAddress(hash, chars);
}

export function explorerTx(hash: string): string {
  return `https://coston2-explorer.flare.network/tx/${hash}`;
}

export function explorerAddress(addr: string): string {
  return `https://coston2-explorer.flare.network/address/${addr}`;
}
