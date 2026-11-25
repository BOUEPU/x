import {
  formatUtcTimestamp,
  pad2,
  parseIsoDateEndUtcMs,
  parseIsoDateStartUtcMs,
} from './csvParser';
import { getAvailableSlotsForTimeframe } from './correlation';
import {
  AnalysisConfig,
  CollectedCandleSlot,
  CollectorConfig,
  CollectorGroupingOptions,
  CollectorProgress,
  CollectorResult,
  DominantDirection,
  EnrichedCandle,
  TimeframeDataset,
  TimeframeId,
  TIMEFRAMES,
  TIMEFRAME_MAP,
} from './types';

const FULL_DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const FULL_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const DEFAULT_COLLECTOR_GROUPING: CollectorGroupingOptions = {
  intraday: 'utc_time',
  daily: 'day_of_week',
  weekly: 'week_of_month',
  monthly: 'month_of_year',
};

function getIsoDowUtc(ms: number): number {
  const d = new Date(ms).getUTCDay(); // 0=Sun..6=Sat
  return d === 0 ? 6 : d - 1; // 0=Mon..6=Sun
}

/**
 * Computes the ISO-8601 week number (1..53) strictly in UTC.
 */
export function getIsoWeekNumberUtc(ms: number): number {
  const d = new Date(ms);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = Date.UTC(target.getUTCFullYear(), 0, 4);
  const diff = target.getTime() - firstThursday;
  return 1 + Math.round(diff / (7 * 86_400_000));
}

function roundTo(val: number, decimals: number): number {
  if (!Number.isFinite(val)) return 0;
  const factor = Math.pow(10, decimals);
  const res = Math.round(val * factor) / factor;
  return Object.is(res, -0) ? 0 : res;
}

interface SlotMeta {
  slotKey: string;
  slotLabel: string;
  sortOrder: number;
  groupingUsed: string;
}

/**
 * Resolves the grouping slot key, human label, and chronological sort order for a candle
 * strictly in UTC based on its timeframe and active grouping options.
 */
export function resolveCollectorSlot(
  timestampMs: number,
  timeframe: TimeframeId,
  grouping: CollectorGroupingOptions
): SlotMeta {
  const d = new Date(timestampMs);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const hhmm = `${pad2(hour)}:${pad2(minute)}`;

  if (TIMEFRAME_MAP[timeframe].isIntraday) {
    if (grouping.intraday === 'dow_utc_time') {
      const dow = getIsoDowUtc(timestampMs);
      const dayName = FULL_DAY_NAMES[dow];
      return {
        slotKey: `${dow}_${hhmm}`,
        slotLabel: `${dayName} ${hhmm} UTC`,
        sortOrder: dow * 1440 + hour * 60 + minute,
        groupingUsed: 'dow_utc_time',
      };
    }
    return {
      slotKey: hhmm,
      slotLabel: `${hhmm} UTC`,
      sortOrder: hour * 60 + minute,
      groupingUsed: 'utc_time',
    };
  }

  if (timeframe === '1D') {
    if (grouping.daily === 'day_of_month') {
      const dom = d.getUTCDate();
      return {
        slotKey: `D${pad2(dom)}`,
        slotLabel: `Day ${dom}`,
        sortOrder: dom,
        groupingUsed: 'day_of_month',
      };
    }
    const dow = getIsoDowUtc(timestampMs);
    return {
      slotKey: `DOW_${dow}`,
      slotLabel: FULL_DAY_NAMES[dow],
      sortOrder: dow,
      groupingUsed: 'day_of_week',
    };
  }

  if (timeframe === '1W') {
    if (grouping.weekly === 'iso_week') {
      const isoWk = getIsoWeekNumberUtc(timestampMs);
      return {
        slotKey: `ISOW_${pad2(isoWk)}`,
        slotLabel: `ISO Week ${isoWk}`,
        sortOrder: isoWk,
        groupingUsed: 'iso_week',
      };
    }
    const wom = Math.floor((d.getUTCDate() - 1) / 7) + 1;
    return {
      slotKey: `W${wom}`,
      slotLabel: `Week ${wom} of Month`,
      sortOrder: wom,
      groupingUsed: 'week_of_month',
    };
  }

  // 1M (Monthly)
  const monthIdx = d.getUTCMonth();
  return {
    slotKey: `M${pad2(monthIdx + 1)}`,
    slotLabel: FULL_MONTH_NAMES[monthIdx],
    sortOrder: monthIdx,
    groupingUsed: 'month_of_year',
  };
}

interface SlotBucket {
  id: string;
  timeframe: TimeframeId;
  slotKey: string;
  slotLabel: string;
  slotSortOrder: number;
  groupingUsed: string;
  bullishCount: number;
  bearishCount: number;
  dojiCount: number;
  sumDiff: number;
  sumRange: number;
  sumVolume: number;
  curBullStreak: number;
  maxBullStreak: number;
  curBearStreak: number;
  maxBearStreak: number;
  history: EnrichedCandle[];
}

function accumulateCandleIntoBucket(
  buckets: Map<string, SlotBucket>,
  candle: EnrichedCandle,
  timeframe: TimeframeId,
  grouping: CollectorGroupingOptions
): void {
  const meta = resolveCollectorSlot(candle.timestamp, timeframe, grouping);
  const id = `${timeframe}::${meta.slotKey}`;

  let bucket = buckets.get(id);
  if (!bucket) {
    bucket = {
      id,
      timeframe,
      slotKey: meta.slotKey,
      slotLabel: meta.slotLabel,
      slotSortOrder: meta.sortOrder,
      groupingUsed: meta.groupingUsed,
      bullishCount: 0,
      bearishCount: 0,
      dojiCount: 0,
      sumDiff: 0,
      sumRange: 0,
      sumVolume: 0,
      curBullStreak: 0,
      maxBullStreak: 0,
      curBearStreak: 0,
      maxBearStreak: 0,
      history: [],
    };
    buckets.set(id, bucket);
  }

  bucket.history.push(candle);
  bucket.sumDiff += candle.diff;
  bucket.sumRange += Math.max(0, candle.high - candle.low);
  bucket.sumVolume += candle.volume;

  if (candle.candleType === 'BULLISH') {
    bucket.bullishCount++;
    bucket.curBullStreak++;
    if (bucket.curBullStreak > bucket.maxBullStreak) {
      bucket.maxBullStreak = bucket.curBullStreak;
    }
    bucket.curBearStreak = 0;
  } else if (candle.candleType === 'BEARISH') {
    bucket.bearishCount++;
    bucket.curBearStreak++;
    if (bucket.curBearStreak > bucket.maxBearStreak) {
      bucket.maxBearStreak = bucket.curBearStreak;
    }
    bucket.curBullStreak = 0;
  } else {
    bucket.dojiCount++;
    bucket.curBullStreak = 0;
    bucket.curBearStreak = 0;
  }
}

function finalizeBuckets(
  buckets: Map<string, SlotBucket>,
  excludeDojiFromPct: boolean
): CollectedCandleSlot[] {
  const slots: CollectedCandleSlot[] = [];

  for (const b of buckets.values()) {
    const totalOccurrences = b.history.length;
    const validNonDojiCount = b.bullishCount + b.bearishCount;
    const denom = excludeDojiFromPct ? validNonDojiCount : totalOccurrences;

    const bullishPct = denom > 0 ? roundTo((b.bullishCount / denom) * 100, 2) : 0;
    const bearishPct = denom > 0 ? roundTo((b.bearishCount / denom) * 100, 2) : 0;
    const dojiPct =
      totalOccurrences > 0 ? roundTo((b.dojiCount / totalOccurrences) * 100, 2) : 0;

    let dominantDirection: DominantDirection = 'NEUTRAL';
    let dominancePct = 0;
    if (validNonDojiCount > 0) {
      if (b.bullishCount >= b.bearishCount) {
        dominantDirection = 'BULLISH';
        dominancePct = Math.max(bullishPct, bearishPct);
      } else {
        dominantDirection = 'BEARISH';
        dominancePct = Math.max(bullishPct, bearishPct);
      }
    }

    slots.push({
      id: b.id,
      timeframe: b.timeframe,
      slotKey: b.slotKey,
      slotLabel: b.slotLabel,
      displayLabel: `${b.timeframe} — ${b.slotLabel}`,
      slotSortOrder: b.slotSortOrder,
      groupingUsed: b.groupingUsed,
      totalOccurrences,
      validNonDojiCount,
      bullishCount: b.bullishCount,
      bullishPct,
      bearishCount: b.bearishCount,
      bearishPct,
      dojiCount: b.dojiCount,
      dojiPct,
      dominantDirection,
      dominancePct,
      avgDiff: totalOccurrences > 0 ? roundTo(b.sumDiff / totalOccurrences, 4) : 0,
      avgRange: totalOccurrences > 0 ? roundTo(b.sumRange / totalOccurrences, 4) : 0,
      avgVolume: totalOccurrences > 0 ? roundTo(b.sumVolume / totalOccurrences, 5) : 0,
      longestBullishStreak: b.maxBullStreak,
      longestBearishStreak: b.maxBearStreak,
      history: b.history,
    });
  }

  // Default order: Timeframe rank ASC, then chronological slot order ASC
  slots.sort((a, b) => {
    const tfDiff = TIMEFRAME_MAP[a.timeframe].rankOrder - TIMEFRAME_MAP[b.timeframe].rankOrder;
    if (tfDiff !== 0) return tfDiff;
    return a.slotSortOrder - b.slotSortOrder;
  });

  return slots;
}

function getTargetTimeframes(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>,
  scope: TimeframeId | 'ALL'
): TimeframeId[] {
  if (scope === 'ALL') {
    return TIMEFRAMES.map((t) => t.id).filter(
      (id) => datasets[id] && datasets[id]!.candles.length > 0
    );
  }
  return datasets[scope] && datasets[scope]!.candles.length > 0 ? [scope] : [];
}

/**
 * Synchronous deterministic Candle Data Collector for unit tests and fast direct calls.
 */
export function collectCandleData(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>,
  config: CollectorConfig
): CollectorResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const computedAtUtc = formatUtcTimestamp(Date.now());
  const targetTfs = getTargetTimeframes(datasets, config.scope);

  if (targetTfs.length === 0) {
    return {
      config,
      timeframesCollected: [],
      totalCandlesScanned: 0,
      totalSlotsCollected: 0,
      slots: [],
      computedAtUtc,
      computeDurationMs: 0,
      warningMessage: 'No uploaded datasets available for the selected scope.',
    };
  }

  const startMs = config.startDateUtc ? parseIsoDateStartUtcMs(config.startDateUtc) : null;
  const endMs = config.endDateUtc ? parseIsoDateEndUtcMs(config.endDateUtc) : null;

  if (startMs !== null && endMs !== null && startMs > endMs) {
    return {
      config,
      timeframesCollected: targetTfs,
      totalCandlesScanned: 0,
      totalSlotsCollected: 0,
      slots: [],
      computedAtUtc,
      computeDurationMs: 0,
      warningMessage: 'Start Date cannot be later than End Date.',
    };
  }

  const buckets = new Map<string, SlotBucket>();
  let totalCandlesScanned = 0;

  for (const tf of targetTfs) {
    const candles = datasets[tf]!.candles;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (startMs !== null && c.timestamp < startMs) continue;
      if (endMs !== null && c.timestamp > endMs) continue;
      totalCandlesScanned++;
      accumulateCandleIntoBucket(buckets, c, tf, config.grouping);
    }
  }

  const slots = finalizeBuckets(buckets, config.excludeDojiFromPct);
  const computeDurationMs = Math.max(
    0,
    roundTo((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0, 2)
  );

  return {
    config,
    timeframesCollected: targetTfs,
    totalCandlesScanned,
    totalSlotsCollected: slots.length,
    slots,
    computedAtUtc,
    computeDurationMs,
    warningMessage:
      slots.length === 0
        ? 'No candles fell within the selected UTC date window.'
        : null,
  };
}

const CHUNK_ROWS = 25_000;

/**
 * Chunked asynchronous collector that yields cleanly to the browser event loop every 25k candles
 * and reports live progress so large multi-year 1MIN datasets never freeze the UI.
 */
export async function collectCandleDataAsync(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>,
  config: CollectorConfig,
  onProgress: (progress: CollectorProgress) => void,
  isCancelled?: () => boolean
): Promise<CollectorResult | null> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const computedAtUtc = formatUtcTimestamp(Date.now());
  const targetTfs = getTargetTimeframes(datasets, config.scope);

  if (targetTfs.length === 0) {
    return {
      config,
      timeframesCollected: [],
      totalCandlesScanned: 0,
      totalSlotsCollected: 0,
      slots: [],
      computedAtUtc,
      computeDurationMs: 0,
      warningMessage: 'No uploaded datasets available for the selected scope.',
    };
  }

  const startMs = config.startDateUtc ? parseIsoDateStartUtcMs(config.startDateUtc) : null;
  const endMs = config.endDateUtc ? parseIsoDateEndUtcMs(config.endDateUtc) : null;

  if (startMs !== null && endMs !== null && startMs > endMs) {
    return {
      config,
      timeframesCollected: targetTfs,
      totalCandlesScanned: 0,
      totalSlotsCollected: 0,
      slots: [],
      computedAtUtc,
      computeDurationMs: 0,
      warningMessage: 'Start Date cannot be later than End Date.',
    };
  }

  const totalCandlesAvailable = targetTfs.reduce(
    (sum, tf) => sum + (datasets[tf]?.candles.length ?? 0),
    0
  );

  const buckets = new Map<string, SlotBucket>();
  let processed = 0;
  let totalCandlesScanned = 0;

  onProgress({
    percent: 0,
    candlesProcessed: 0,
    totalCandles: totalCandlesAvailable,
    currentTimeframe: targetTfs[0],
  });

  for (const tf of targetTfs) {
    const candles = datasets[tf]!.candles;
    for (let offset = 0; offset < candles.length; offset += CHUNK_ROWS) {
      if (isCancelled?.()) return null;

      const limit = Math.min(offset + CHUNK_ROWS, candles.length);
      for (let i = offset; i < limit; i++) {
        const c = candles[i];
        if (startMs !== null && c.timestamp < startMs) continue;
        if (endMs !== null && c.timestamp > endMs) continue;
        totalCandlesScanned++;
        accumulateCandleIntoBucket(buckets, c, tf, config.grouping);
      }

      processed += limit - offset;
      const pct =
        totalCandlesAvailable > 0
          ? Math.min(99, Math.round((processed / totalCandlesAvailable) * 95))
          : 95;

      onProgress({
        percent: pct,
        candlesProcessed: processed,
        totalCandles: totalCandlesAvailable,
        currentTimeframe: tf,
      });

      // Yield to browser paint loop on multi-chunk workloads
      if (totalCandlesAvailable > CHUNK_ROWS) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  if (isCancelled?.()) return null;

  const slots = finalizeBuckets(buckets, config.excludeDojiFromPct);
  const computeDurationMs = Math.max(
    0,
    roundTo((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0, 2)
  );

  onProgress({
    percent: 100,
    candlesProcessed: totalCandlesAvailable,
    totalCandles: totalCandlesAvailable,
    currentTimeframe: null,
  });

  return {
    config,
    timeframesCollected: targetTfs,
    totalCandlesScanned,
    totalSlotsCollected: slots.length,
    slots,
    computedAtUtc,
    computeDurationMs,
    warningMessage:
      slots.length === 0
        ? 'No candles fell within the selected UTC date window.'
        : null,
  };
}

/**
 * Re-computes Bullish %, Bearish %, and Dominance % when toggling Exclude Doji without re-scanning
 * all raw candles. Also filters by minOccurrences and search query.
 */
export function filterCollectedSlots(
  slots: CollectedCandleSlot[],
  options: {
    excludeDojiFromPct: boolean;
    minOccurrences: number;
    searchQuery: string;
  }
): CollectedCandleSlot[] {
  const query = options.searchQuery.trim().toLowerCase();
  const output: CollectedCandleSlot[] = [];

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.totalOccurrences < options.minOccurrences) continue;
    if (
      query &&
      !s.displayLabel.toLowerCase().includes(query) &&
      !s.slotLabel.toLowerCase().includes(query) &&
      !s.timeframe.toLowerCase().includes(query)
    ) {
      continue;
    }

    const denom = options.excludeDojiFromPct ? s.validNonDojiCount : s.totalOccurrences;
    const bullishPct = denom > 0 ? roundTo((s.bullishCount / denom) * 100, 2) : 0;
    const bearishPct = denom > 0 ? roundTo((s.bearishCount / denom) * 100, 2) : 0;
    const dominancePct =
      s.validNonDojiCount > 0 ? Math.max(bullishPct, bearishPct) : 0;

    if (
      bullishPct === s.bullishPct &&
      bearishPct === s.bearishPct &&
      dominancePct === s.dominancePct
    ) {
      output.push(s);
    } else {
      output.push({
        ...s,
        bullishPct,
        bearishPct,
        dominancePct,
      });
    }
  }

  return output;
}

/**
 * Maps a collected candle slot seamlessly into an AnalysisConfig for the Principal vs. Target
 * Candle Analyzer, guaranteeing the pre-selected Target timeframe and slotKey exist and align.
 */
export function buildTargetConfigFromCollectedSlot(
  slot: CollectedCandleSlot,
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>,
  dateRange?: { startDateUtc: string; endDateUtc: string }
): AnalysisConfig {
  const loadedTfs = TIMEFRAMES.map((t) => t.id).filter(
    (id) => datasets[id] && datasets[id]!.candles.length > 0
  );
  const startDateUtc = dateRange?.startDateUtc ?? '';
  const endDateUtc = dateRange?.endDateUtc ?? '';
  const tf = slot.timeframe;
  const targetCandles = datasets[tf]?.candles ?? [];

  const otherIntraday = loadedTfs.find(
    (id) => id !== tf && TIMEFRAME_MAP[id].isIntraday
  );
  const has1D = loadedTfs.includes('1D');
  const has1W = loadedTfs.includes('1W');

  // Case 1: Intraday UTC Time (e.g. 1H — 14:00 UTC)
  if (slot.groupingUsed === 'utc_time') {
    if (otherIntraday) {
      return {
        mode: 'cross',
        targetTimeframe: tf,
        searchTimeframe: otherIntraday,
        crossStrategy: 'specific_slot',
        sameStrategy: 'specific_slot',
        targetSlotKey: slot.slotKey,
        maxLagCandles: 12,
        includeLeadOffsets: false,
        startDateUtc,
        endDateUtc,
      };
    }
    return {
      mode: 'same',
      targetTimeframe: tf,
      searchTimeframe: tf,
      crossStrategy: 'specific_slot',
      sameStrategy: 'specific_slot',
      targetSlotKey: slot.slotKey,
      maxLagCandles: 12,
      includeLeadOffsets: false,
      startDateUtc,
      endDateUtc,
    };
  }

  // Case 2: Intraday Day-of-Week + UTC Time (e.g. Monday 14:00 UTC)
  if (slot.groupingUsed === 'dow_utc_time') {
    if (has1D) {
      return {
        mode: 'cross',
        targetTimeframe: tf,
        searchTimeframe: '1D',
        crossStrategy: 'specific_slot',
        sameStrategy: 'specific_slot',
        targetSlotKey: slot.slotKey,
        maxLagCandles: 12,
        includeLeadOffsets: false,
        startDateUtc,
        endDateUtc,
      };
    }
    const hhmm = slot.slotKey.includes('_') ? slot.slotKey.split('_')[1] : slot.slotKey;
    return {
      mode: 'same',
      targetTimeframe: tf,
      searchTimeframe: tf,
      crossStrategy: 'specific_slot',
      sameStrategy: 'specific_slot',
      targetSlotKey: hhmm,
      maxLagCandles: 12,
      includeLeadOffsets: false,
      startDateUtc,
      endDateUtc,
    };
  }

  // Case 3: Daily Day of Week (e.g. 1D — Monday)
  if (slot.groupingUsed === 'day_of_week') {
    if (otherIntraday) {
      return {
        mode: 'cross',
        targetTimeframe: '1D',
        searchTimeframe: otherIntraday,
        crossStrategy: 'specific_slot',
        sameStrategy: 'specific_slot',
        targetSlotKey: slot.slotKey,
        maxLagCandles: 12,
        includeLeadOffsets: false,
        startDateUtc,
        endDateUtc,
      };
    }
    return {
      mode: 'same',
      targetTimeframe: '1D',
      searchTimeframe: '1D',
      crossStrategy: 'specific_slot',
      sameStrategy: 'specific_slot',
      targetSlotKey: slot.slotKey,
      maxLagCandles: 12,
      includeLeadOffsets: false,
      startDateUtc,
      endDateUtc,
    };
  }

  // Case 4: Daily Day of Month (e.g. 1D — Day 15)
  if (slot.groupingUsed === 'day_of_month') {
    if (has1W) {
      return {
        mode: 'cross',
        targetTimeframe: '1D',
        searchTimeframe: '1W',
        crossStrategy: 'specific_slot',
        sameStrategy: 'specific_slot',
        targetSlotKey: slot.slotKey,
        maxLagCandles: 12,
        includeLeadOffsets: false,
        startDateUtc,
        endDateUtc,
      };
    }
    if (otherIntraday) {
      return {
        mode: 'cross',
        targetTimeframe: '1D',
        searchTimeframe: otherIntraday,
        crossStrategy: 'parent_window',
        sameStrategy: 'specific_slot',
        targetSlotKey: null,
        maxLagCandles: 12,
        includeLeadOffsets: false,
        startDateUtc,
        endDateUtc,
      };
    }
  }

  // Case 5: Weekly (Week of Month or ISO Week) & Monthly (Month of Year)
  const validSameSlots = getAvailableSlotsForTimeframe(targetCandles, tf, tf);
  const exactMatch = validSameSlots.find((s) => s.key === slot.slotKey);

  return {
    mode: 'same',
    targetTimeframe: tf,
    searchTimeframe: tf,
    crossStrategy: 'specific_slot',
    sameStrategy: 'specific_slot',
    targetSlotKey: exactMatch ? exactMatch.key : (validSameSlots[0]?.key ?? null),
    maxLagCandles: 12,
    includeLeadOffsets: false,
    startDateUtc,
    endDateUtc,
  };
}
