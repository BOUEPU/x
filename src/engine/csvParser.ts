import { EnrichedCandle, MalformedRow, RawCandle, TimeframeId, TIMEFRAME_MAP } from './types';

const TIMESTAMP_REGEX = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/;
const SCALE_8 = 1e8;

/**
 * Strictly parses a UTC timestamp in `YYYY.MM.DD HH:MM:SS` format using Date.UTC.
 * Never delegates to `new Date(str)` to avoid local timezone shifts or browser quirks.
 * Returns epoch milliseconds (UTC) or null if invalid.
 */
export function parseStrictUtcTimestamp(raw: string): { timestamp: number; canonical: string } | null {
  const trimmed = raw.trim();
  const match = TIMESTAMP_REGEX.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    second < 0 || second > 59
  ) {
    return null;
  }

  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(ms)) return null;

  // Verify calendar validity (rejects dates like 2021.02.30 or 2021.04.31)
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }

  const canonical = `${match[1]}.${match[2]}.${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
  return { timestamp: ms, canonical };
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatUtcTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function formatUtcDateIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function parseIsoDateStartUtcMs(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  return Number.isFinite(ms) ? ms : null;
}

export function parseIsoDateEndUtcMs(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Returns the exclusive UTC end timestamp for a candle starting at `startMs`.
 * Handles variable month lengths for 1M candles accurately.
 */
export function getCandleEndMs(startMs: number, timeframe: TimeframeId): number {
  if (timeframe === '1M') {
    const d = new Date(startMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  }
  return startMs + TIMEFRAME_MAP[timeframe].durationMs;
}

/**
 * Precision-safe subtraction `Close - Open` rounded to 8 decimal places.
 * Uses integer scaling to eliminate IEEE-754 float artifacts (e.g., 0.00000000000004).
 */
export function computeSafeDiff(open: number, close: number): number {
  const scaledDiff = Math.round(close * SCALE_8) - Math.round(open * SCALE_8);
  const result = scaledDiff / SCALE_8;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * Formats a number cleanly without trailing scientific notation or noisy floating point decimals.
 */
export function formatDecimal(value: number, maxDecimals = 8): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(maxDecimals));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export interface HeaderValidationResult {
  valid: boolean;
  headers: string[];
  error?: string;
}

const EXPECTED_HEADERS = ['time (utc)', 'open', 'high', 'low', 'close', 'volume'];

export function validateCsvHeader(headerLine: string): HeaderValidationResult {
  const cleanedLine = headerLine.replace(/^\uFEFF/, '');
  const headers = cleanedLine.split(',').map((h) => h.trim());

  if (headers.length < 6) {
    return {
      valid: false,
      headers,
      error: `Expected 6 columns (Time (UTC), Open, High, Low, Close, Volume), found ${headers.length}.`,
    };
  }

  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (headers[i].toLowerCase() !== EXPECTED_HEADERS[i]) {
      return {
        valid: false,
        headers,
        error: `Column ${i} expected "${EXPECTED_HEADERS[i]}", found "${headers[i]}".`,
      };
    }
  }

  return { valid: true, headers: headers.slice(0, 6) };
}

export interface ParsedLineResult {
  candle?: RawCandle;
  malformed?: MalformedRow;
  empty?: boolean;
}

export function parseCsvDataLine(rawLine: string, lineNumber: number): ParsedLineResult {
  const trimmedLine = rawLine.trim();
  if (trimmedLine.length === 0) {
    return { empty: true };
  }

  const cells = rawLine.split(',');
  if (cells.length < 6) {
    return {
      malformed: {
        lineNumber,
        rawLine: trimmedLine.slice(0, 140),
        reason: `Expected at least 6 comma-separated columns, got ${cells.length}`,
      },
    };
  }

  const timeCell = cells[0].trim();
  const openCell = cells[1].trim();
  const highCell = cells[2].trim();
  const lowCell = cells[3].trim();
  const closeCell = cells[4].trim();
  const volumeCell = cells[5].trim();

  const parsedTime = parseStrictUtcTimestamp(timeCell);
  if (!parsedTime) {
    return {
      malformed: {
        lineNumber,
        rawLine: trimmedLine.slice(0, 140),
        reason: `Invalid UTC timestamp "${timeCell}" (expected YYYY.MM.DD HH:MM:SS)`,
      },
    };
  }

  const open = Number(openCell);
  const high = Number(highCell);
  const low = Number(lowCell);
  const close = Number(closeCell);
  const volume = Number(volumeCell);

  if (
    openCell === '' || highCell === '' || lowCell === '' || closeCell === '' || volumeCell === '' ||
    !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) ||
    !Number.isFinite(close) || !Number.isFinite(volume)
  ) {
    return {
      malformed: {
        lineNumber,
        rawLine: trimmedLine.slice(0, 140),
        reason: 'Non-numeric or missing OHLCV value',
      },
    };
  }

  if (high < low) {
    return {
      malformed: {
        lineNumber,
        rawLine: trimmedLine.slice(0, 140),
        reason: `High (${high}) is lower than Low (${low})`,
      },
    };
  }

  return {
    candle: {
      timestamp: parsedTime.timestamp,
      timeStr: parsedTime.canonical,
      open,
      high,
      low,
      close,
      volume,
    },
  };
}

export interface SortDedupResult {
  candles: RawCandle[];
  duplicateCount: number;
}

/**
 * Sorts candles in ascending chronological UTC order and removes exact duplicate timestamps
 * (keeping the first occurrence of each timestamp).
 */
export function sortAndDeduplicateCandles(rawCandles: RawCandle[]): SortDedupResult {
  if (rawCandles.length <= 1) {
    return { candles: rawCandles.slice(), duplicateCount: 0 };
  }

  // Check if already sorted strictly ascending to avoid O(n log n) sort overhead on clean files
  let isStrictlySorted = true;
  for (let i = 1; i < rawCandles.length; i++) {
    if (rawCandles[i].timestamp <= rawCandles[i - 1].timestamp) {
      isStrictlySorted = false;
      break;
    }
  }
  if (isStrictlySorted) {
    return { candles: rawCandles.slice(), duplicateCount: 0 };
  }

  const sorted = rawCandles.slice().sort((a, b) => a.timestamp - b.timestamp);
  const deduped: RawCandle[] = [];
  let duplicateCount = 0;
  let lastTs = -Infinity;

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.timestamp === lastTs) {
      duplicateCount++;
      continue;
    }
    deduped.push(c);
    lastTs = c.timestamp;
  }

  return { candles: deduped, duplicateCount };
}

export interface ParsedCsvCoreResult {
  headersDetected: string[];
  rawCandles: RawCandle[];
  duplicateCount: number;
  malformedRows: MalformedRow[];
  malformedCount: number;
}

const MAX_LOGGED_MALFORMED = 200;

/**
 * Synchronous full-string CSV parser for unit tests and small inputs.
 * Handles both `\r\n` and `\n`, skips empty lines, validates headers & rows,
 * sorts ascending UTC, and removes exact duplicate timestamps.
 */
export function parseCsvText(csvText: string): ParsedCsvCoreResult {
  const lines = csvText.split(/\r?\n/);
  let headerIndex = -1;
  let headersDetected: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      const headerCheck = validateCsvHeader(lines[i]);
      if (!headerCheck.valid) {
        throw new Error(headerCheck.error || 'Invalid CSV header row.');
      }
      headerIndex = i;
      headersDetected = headerCheck.headers;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error('CSV file is empty.');
  }

  const parsed: RawCandle[] = [];
  const malformedRows: MalformedRow[] = [];
  let malformedCount = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const res = parseCsvDataLine(lines[i], i + 1);
    if (res.empty) continue;
    if (res.malformed) {
      malformedCount++;
      if (malformedRows.length < MAX_LOGGED_MALFORMED) {
        malformedRows.push(res.malformed);
      }
    } else if (res.candle) {
      parsed.push(res.candle);
    }
  }

  const { candles, duplicateCount } = sortAndDeduplicateCandles(parsed);

  return {
    headersDetected,
    rawCandles: candles,
    duplicateCount,
    malformedRows,
    malformedCount,
  };
}

/**
 * Helper to format an EnrichedCandle array into CSV text with Diff and Candle_Type.
 */
export function serializeEnrichedCandlesToCsv(candles: EnrichedCandle[]): string {
  const header = 'Time (UTC),Open,High,Low,Close,Volume,Diff,Candle_Type';
  const rows = new Array<string>(candles.length + 1);
  rows[0] = header;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    rows[i + 1] = `${c.timeStr},${c.open},${c.high},${c.low},${c.close},${c.volume},${formatDecimal(c.diff, 8)},${c.candleType}`;
  }
  return rows.join('\n');
}
