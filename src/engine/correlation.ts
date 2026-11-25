import {
  formatUtcDateIso,
  formatUtcTimestamp,
  getCandleEndMs,
  pad2,
  parseIsoDateEndUtcMs,
  parseIsoDateStartUtcMs,
} from './csvParser';
import {
  AnalysisConfig,
  AnalysisResult,
  BestMatchConfig,
  BestMatchFilterState,
  BestMatchItem,
  BestMatchProgress,
  BestMatchResult,
  CandleGeometryFeatures,
  CandleType,
  EnrichedCandle,
  IntradayDayRecord,
  IntradayDirectionFilter,
  IntradayFullMatrixAnchorSummary,
  IntradaySlotFilterState,
  IntradaySlotMatchConfig,
  IntradaySlotMatchItem,
  IntradaySlotMatchResult,
  MatchedCandleSnapshot,
  PairRecord,
  PrincipalCandidateResult,
  ResultsFilterState,
  SlotOption,
  TimeframeDataset,
  TimeframeId,
  TIMEFRAMES,
  TIMEFRAME_MAP,
  TimingRelation,
} from './types';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

type CycleUnit = 'day' | 'week' | 'month' | 'year';

/**
 * Returns Monday-based day of week index: Mon = 0, Tue = 1, ..., Sun = 6 (UTC).
 */
function getIsoDowUtc(ms: number): number {
  const d = new Date(ms).getUTCDay(); // 0=Sun..6=Sat
  return d === 0 ? 6 : d - 1;
}

/**
 * Returns the Monday 00:00:00 UTC date key `YYYY-MM-DD` representing the UTC week containing `ms`.
 */
function getUtcWeekKey(ms: number): string {
  const d = new Date(ms);
  const dow = getIsoDowUtc(ms);
  const mondayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
  return formatUtcDateIso(mondayMs);
}

/**
 * Determines the natural cycle grouping unit for slot-based comparison given the timeframes involved.
 */
export function resolveCycleUnit(tfA: TimeframeId, tfB: TimeframeId): CycleUnit {
  const maxRank = Math.max(TIMEFRAME_MAP[tfA].rankOrder, TIMEFRAME_MAP[tfB].rankOrder);
  // Intraday (1MIN..4H) -> Cycle is UTC Day
  if (maxRank <= 7) return 'day';
  // Daily (1D) -> Cycle is UTC Week (Mon..Sun)
  if (maxRank === 8) return 'week';
  // Weekly (1W) -> Cycle is UTC Month
  if (maxRank === 9) return 'month';
  // Monthly (1M) -> Cycle is UTC Year
  return 'year';
}

interface CycleSlotInfo {
  cycleKey: string;
  cycleDateStr: string;
  slotKey: string;
  slotLabel: string;
  sortOrder: number;
}

function getCycleAndSlot(ms: number, tf: TimeframeId, cycleUnit: CycleUnit): CycleSlotInfo {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const date = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const hhmm = `${pad2(hour)}:${pad2(minute)}`;

  if (cycleUnit === 'day') {
    const dateStr = formatUtcDateIso(ms);
    return {
      cycleKey: dateStr,
      cycleDateStr: dateStr,
      slotKey: hhmm,
      slotLabel: `${hhmm} UTC`,
      sortOrder: hour * 60 + minute,
    };
  }

  if (cycleUnit === 'week') {
    const weekMonday = getUtcWeekKey(ms);
    const dow = getIsoDowUtc(ms);
    const dayName = DAY_NAMES[dow];
    if (TIMEFRAME_MAP[tf].isIntraday) {
      return {
        cycleKey: weekMonday,
        cycleDateStr: `Wk ${weekMonday}`,
        slotKey: `${dow}_${hhmm}`,
        slotLabel: `${dayName} ${hhmm} UTC`,
        sortOrder: dow * 1440 + hour * 60 + minute,
      };
    }
    return {
      cycleKey: weekMonday,
      cycleDateStr: `Wk ${weekMonday}`,
      slotKey: `DOW_${dow}`,
      slotLabel: `${dayName} (1D)`,
      sortOrder: dow,
    };
  }

  if (cycleUnit === 'month') {
    const monthKey = `${year}-${pad2(month + 1)}`;
    if (tf === '1W') {
      const weekOfMonth = Math.floor((date - 1) / 7) + 1;
      return {
        cycleKey: monthKey,
        cycleDateStr: monthKey,
        slotKey: `W${weekOfMonth}`,
        slotLabel: `Week ${weekOfMonth} of Month`,
        sortOrder: weekOfMonth,
      };
    }
    if (tf === '1D') {
      return {
        cycleKey: monthKey,
        cycleDateStr: monthKey,
        slotKey: `D${pad2(date)}`,
        slotLabel: `Day ${pad2(date)}`,
        sortOrder: date,
      };
    }
    return {
      cycleKey: monthKey,
      cycleDateStr: monthKey,
      slotKey: `D${pad2(date)}_${hhmm}`,
      slotLabel: `Day ${pad2(date)} ${hhmm} UTC`,
      sortOrder: date * 1440 + hour * 60 + minute,
    };
  }

  // cycleUnit === 'year'
  const yearKey = `${year}`;
  if (tf === '1M') {
    return {
      cycleKey: yearKey,
      cycleDateStr: yearKey,
      slotKey: `M${pad2(month + 1)}`,
      slotLabel: MONTH_NAMES[month],
      sortOrder: month,
    };
  }
  return {
    cycleKey: yearKey,
    cycleDateStr: yearKey,
    slotKey: `M${pad2(month + 1)}_D${pad2(date)}`,
    slotLabel: `${MONTH_NAMES[month]} ${pad2(date)}`,
    sortOrder: month * 31 + date,
  };
}

/**
 * Extracts all unique available Target slots for a given timeframe & cycle unit,
 * sorted chronologically, with occurrence counts.
 */
export function getAvailableSlotsForTimeframe(
  candles: EnrichedCandle[],
  targetTf: TimeframeId,
  searchTf: TimeframeId
): SlotOption[] {
  const cycleUnit = resolveCycleUnit(targetTf, searchTf);
  const map = new Map<string, SlotOption>();

  for (let i = 0; i < candles.length; i++) {
    const info = getCycleAndSlot(candles[i].timestamp, targetTf, cycleUnit);
    const existing = map.get(info.slotKey);
    if (existing) {
      existing.count++;
    } else {
      map.set(info.slotKey, {
        key: info.slotKey,
        label: info.slotLabel,
        sortOrder: info.sortOrder,
        count: 1,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Formats a timing delta (in ms) into a concise human-readable relation label.
 */
function formatDurationCompact(absMs: number): string {
  const totalMinutes = Math.round(absMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function computeTimingRelation(
  principalEndMs: number,
  targetEndMs: number
): { relation: TimingRelation; detail: string } {
  const delta = targetEndMs - principalEndMs;
  if (delta > 0) {
    return {
      relation: 'BEFORE',
      detail: `Closes ${formatDurationCompact(delta)} before Target`,
    };
  }
  if (delta === 0) {
    return {
      relation: 'INSIDE',
      detail: 'Closes simultaneously with Target',
    };
  }
  return {
    relation: 'AFTER',
    detail: `Closes ${formatDurationCompact(-delta)} after Target`,
  };
}

/**
 * Computes the slot key & label for a child candle inside its parent Target candle window.
 */
function getParentChildSlot(
  principalMs: number,
  targetMs: number,
  targetTf: TimeframeId,
  searchTf: TimeframeId
): { slotKey: string; slotLabel: string; sortOrder: number } {
  const pDate = new Date(principalMs);
  const offsetMin = Math.round((principalMs - targetMs) / 60_000);

  if (targetTf === '1D' && TIMEFRAME_MAP[searchTf].isIntraday) {
    const hhmm = `${pad2(pDate.getUTCHours())}:${pad2(pDate.getUTCMinutes())}`;
    return {
      slotKey: hhmm,
      slotLabel: `${hhmm} UTC`,
      sortOrder: pDate.getUTCHours() * 60 + pDate.getUTCMinutes(),
    };
  }

  if (targetTf === '4H') {
    const h = Math.floor(offsetMin / 60);
    const m = offsetMin % 60;
    const label = `+${pad2(h)}:${pad2(m)} in 4H bar`;
    return {
      slotKey: `OFF_${offsetMin}`,
      slotLabel: label,
      sortOrder: offsetMin,
    };
  }

  if (targetTf === '1H') {
    const m = pDate.getUTCMinutes();
    return {
      slotKey: `MIN_${pad2(m)}`,
      slotLabel: `:${pad2(m)} of Hour`,
      sortOrder: m,
    };
  }

  if (TIMEFRAME_MAP[targetTf].isIntraday) {
    return {
      slotKey: `OFF_${offsetMin}`,
      slotLabel: `+${pad2(offsetMin)}m in ${targetTf}`,
      sortOrder: offsetMin,
    };
  }

  if (targetTf === '1W') {
    const dow = getIsoDowUtc(principalMs);
    const dayName = DAY_NAMES[dow];
    if (searchTf === '1D') {
      return {
        slotKey: `DOW_${dow}`,
        slotLabel: `${dayName} (Day ${Math.floor(offsetMin / 1440) + 1})`,
        sortOrder: offsetMin,
      };
    }
    const hhmm = `${pad2(pDate.getUTCHours())}:${pad2(pDate.getUTCMinutes())}`;
    return {
      slotKey: `DOW_${dow}_${hhmm}`,
      slotLabel: `${dayName} ${hhmm} UTC`,
      sortOrder: offsetMin,
    };
  }

  // targetTf === '1M'
  const dayOfMonth = pDate.getUTCDate();
  if (searchTf === '1D') {
    return {
      slotKey: `DOM_${pad2(dayOfMonth)}`,
      slotLabel: `Day ${pad2(dayOfMonth)}`,
      sortOrder: dayOfMonth,
    };
  }
  if (searchTf === '1W') {
    const weekIdx = Math.floor((dayOfMonth - 1) / 7) + 1;
    return {
      slotKey: `WK_${weekIdx}`,
      slotLabel: `Week ${weekIdx}`,
      sortOrder: weekIdx,
    };
  }
  const hhmm = `${pad2(pDate.getUTCHours())}:${pad2(pDate.getUTCMinutes())}`;
  return {
    slotKey: `DOM_${pad2(dayOfMonth)}_${hhmm}`,
    slotLabel: `Day ${pad2(dayOfMonth)} ${hhmm} UTC`,
    sortOrder: dayOfMonth * 1440 + pDate.getUTCHours() * 60 + pDate.getUTCMinutes(),
  };
}

interface CandidateAccumulator {
  slotKey: string;
  slotLabel: string;
  slotSortOrder: number;
  totalValidPairs: number;
  excludedDojiPairs: number;
  targetBullishCount: number;
  bullishMatches: number;
  targetBearishCount: number;
  bearishMatches: number;
  timingRelation: TimingRelation;
  timingDetail: string;
  pairs: PairRecord[];
}

function recordPair(
  accMap: Map<string, CandidateAccumulator>,
  slotKey: string,
  slotLabel: string,
  slotSortOrder: number,
  cycleKey: string,
  cycleDateStr: string,
  target: EnrichedCandle,
  principal: EnrichedCandle,
  targetTf: TimeframeId,
  searchTf: TimeframeId
): { isDojiExcluded: boolean } {
  const targetEndMs = getCandleEndMs(target.timestamp, targetTf);
  const principalEndMs = getCandleEndMs(principal.timestamp, searchTf);
  const timing = computeTimingRelation(principalEndMs, targetEndMs);

  let acc = accMap.get(slotKey);
  if (!acc) {
    acc = {
      slotKey,
      slotLabel,
      slotSortOrder,
      totalValidPairs: 0,
      excludedDojiPairs: 0,
      targetBullishCount: 0,
      bullishMatches: 0,
      targetBearishCount: 0,
      bearishMatches: 0,
      timingRelation: timing.relation,
      timingDetail: timing.detail,
      pairs: [],
    };
    accMap.set(slotKey, acc);
  }

  const isDojiExcluded = target.candleType === 'DOJI' || principal.candleType === 'DOJI';
  let isMatch = false;

  if (isDojiExcluded) {
    acc.excludedDojiPairs++;
  } else {
    acc.totalValidPairs++;
    if (target.candleType === 'BULLISH') {
      acc.targetBullishCount++;
      if (principal.candleType === 'BULLISH') {
        acc.bullishMatches++;
        isMatch = true;
      }
    } else if (target.candleType === 'BEARISH') {
      acc.targetBearishCount++;
      if (principal.candleType === 'BEARISH') {
        acc.bearishMatches++;
        isMatch = true;
      }
    }
  }

  acc.pairs.push({
    cycleKey,
    cycleDateStr,
    targetTimestamp: target.timestamp,
    targetTimeStr: target.timeStr,
    targetOpen: target.open,
    targetClose: target.close,
    targetDiff: target.diff,
    targetType: target.candleType,
    principalTimestamp: principal.timestamp,
    principalTimeStr: principal.timeStr,
    principalOpen: principal.open,
    principalClose: principal.close,
    principalDiff: principal.diff,
    principalType: principal.candleType,
    isMatch,
    isDojiExcluded,
    timingRelation: timing.relation,
  });

  return { isDojiExcluded };
}

function finalizeCandidates(
  accMap: Map<string, CandidateAccumulator>,
  searchTimeframe: TimeframeId
): PrincipalCandidateResult[] {
  const list: PrincipalCandidateResult[] = [];

  for (const acc of accMap.values()) {
    const bullishMatchRate =
      acc.targetBullishCount > 0
        ? Number(((acc.bullishMatches / acc.targetBullishCount) * 100).toFixed(2))
        : null;
    const bearishMatchRate =
      acc.targetBearishCount > 0
        ? Number(((acc.bearishMatches / acc.targetBearishCount) * 100).toFixed(2))
        : null;
    const overallAlignmentScore =
      acc.totalValidPairs > 0
        ? Number((((acc.bullishMatches + acc.bearishMatches) / acc.totalValidPairs) * 100).toFixed(2))
        : 0;

    list.push({
      slotKey: acc.slotKey,
      slotLabel: acc.slotLabel,
      slotSortOrder: acc.slotSortOrder,
      searchTimeframe,
      totalValidPairs: acc.totalValidPairs,
      excludedDojiPairs: acc.excludedDojiPairs,
      targetBullishCount: acc.targetBullishCount,
      bullishMatches: acc.bullishMatches,
      bullishMatchRate,
      targetBearishCount: acc.targetBearishCount,
      bearishMatches: acc.bearishMatches,
      bearishMatchRate,
      overallAlignmentScore,
      timingRelation: acc.timingRelation,
      timingDetail: acc.timingDetail,
      pairs: acc.pairs,
    });
  }

  // Rank: Overall Alignment Score DESC -> Sample Size N DESC -> Chronological Slot Order ASC
  list.sort((a, b) => {
    if (b.overallAlignmentScore !== a.overallAlignmentScore) {
      return b.overallAlignmentScore - a.overallAlignmentScore;
    }
    if (b.totalValidPairs !== a.totalValidPairs) {
      return b.totalValidPairs - a.totalValidPairs;
    }
    return a.slotSortOrder - b.slotSortOrder;
  });

  return list;
}

function filterCandlesByDateRange(
  candles: EnrichedCandle[],
  startMs: number | null,
  endMs: number | null
): EnrichedCandle[] {
  if (startMs === null && endMs === null) return candles;
  return candles.filter((c) => {
    if (startMs !== null && c.timestamp < startMs) return false;
    if (endMs !== null && c.timestamp > endMs) return false;
    return true;
  });
}

/**
 * Computes the overlapping UTC date window between two datasets.
 * Accounts for partial first/last days (e.g., 1H starting at 2021.01.01 22:00 while 1D starts at 00:00)
 * by comparing candle windows [start, end).
 */
export function computeDateOverlap(
  targetDataset: TimeframeDataset,
  searchDataset: TimeframeDataset
): { overlapStartMs: number | null; overlapEndMs: number | null; hasOverlap: boolean } {
  if (
    targetDataset.candles.length === 0 ||
    searchDataset.candles.length === 0 ||
    targetDataset.startUtcMs === null ||
    targetDataset.endUtcMs === null ||
    searchDataset.startUtcMs === null ||
    searchDataset.endUtcMs === null
  ) {
    return { overlapStartMs: null, overlapEndMs: null, hasOverlap: false };
  }

  const targetWindowEnd = getCandleEndMs(targetDataset.endUtcMs, targetDataset.timeframe) - 1;
  const searchWindowEnd = getCandleEndMs(searchDataset.endUtcMs, searchDataset.timeframe) - 1;

  const overlapStartMs = Math.max(targetDataset.startUtcMs, searchDataset.startUtcMs);
  const overlapEndMs = Math.min(targetWindowEnd, searchWindowEnd);

  if (overlapStartMs > overlapEndMs) {
    return { overlapStartMs: null, overlapEndMs: null, hasOverlap: false };
  }

  return { overlapStartMs, overlapEndMs, hasOverlap: true };
}

/**
 * Main Principal Candle vs Target Candle Analysis Engine.
 * Strictly deterministic, pure TypeScript, zero mutation of input datasets.
 */
export function runCorrelationAnalysis(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>,
  config: AnalysisConfig
): AnalysisResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const computedAtUtc = formatUtcTimestamp(Date.now());

  const targetDs = datasets[config.targetTimeframe];
  const searchTf = config.mode === 'same' ? config.targetTimeframe : config.searchTimeframe;
  const searchDs = datasets[searchTf];

  const makeEmptyResult = (warningMessage: string, targetDesc = '', searchDesc = ''): AnalysisResult => ({
    config,
    targetDescription: targetDesc || config.targetTimeframe,
    searchDescription: searchDesc || searchTf,
    overlapStartUtc: null,
    overlapEndUtc: null,
    effectiveStartUtc: null,
    effectiveEndUtc: null,
    totalCyclesScanned: 0,
    totalValidCycles: 0,
    totalExcludedTargetDojis: 0,
    totalExcludedDojiPairs: 0,
    candidates: [],
    warningMessage,
    computedAtUtc,
    computeDurationMs: Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
  });

  if (!targetDs || targetDs.candles.length === 0) {
    return makeEmptyResult(`Target timeframe ${config.targetTimeframe} has no loaded candles.`);
  }
  if (!searchDs || searchDs.candles.length === 0) {
    return makeEmptyResult(`Search timeframe ${searchTf} has no loaded candles.`);
  }

  const overlap = computeDateOverlap(targetDs, searchDs);
  if (!overlap.hasOverlap || overlap.overlapStartMs === null || overlap.overlapEndMs === null) {
    return makeEmptyResult(
      `Non-overlapping UTC date ranges: ${targetDs.timeframe} covers ${targetDs.startUtcStr ?? 'N/A'} to ${targetDs.endUtcStr ?? 'N/A'}, while ${searchDs.timeframe} covers ${searchDs.startUtcStr ?? 'N/A'} to ${searchDs.endUtcStr ?? 'N/A'}.`
    );
  }

  const overlapStartIso = formatUtcDateIso(overlap.overlapStartMs);
  const overlapEndIso = formatUtcDateIso(overlap.overlapEndMs);

  const filterStartMs = config.startDateUtc ? parseIsoDateStartUtcMs(config.startDateUtc) : null;
  const filterEndMs = config.endDateUtc ? parseIsoDateEndUtcMs(config.endDateUtc) : null;

  if (filterStartMs !== null && filterEndMs !== null && filterStartMs > filterEndMs) {
    return makeEmptyResult('Start date cannot be after end date.');
  }

  // Apply user date bounds; include Target candle if its window overlaps [filterStartMs, filterEndMs]
  const targetCandles = targetDs.candles.filter((c) => {
    const cEnd = getCandleEndMs(c.timestamp, targetDs.timeframe) - 1;
    if (filterStartMs !== null && cEnd < filterStartMs) return false;
    if (filterEndMs !== null && c.timestamp > filterEndMs) return false;
    return true;
  });

  const searchCandles = filterCandlesByDateRange(searchDs.candles, filterStartMs, filterEndMs);

  if (targetCandles.length === 0 || searchCandles.length === 0) {
    return makeEmptyResult(
      'No candles fall inside the selected UTC date range filter. Expand the date bounds to analyze.'
    );
  }

  const accMap = new Map<string, CandidateAccumulator>();
  let totalCyclesScanned = 0;
  let totalValidCycles = 0;
  let totalExcludedTargetDojis = 0;
  let totalExcludedDojiPairs = 0;
  let targetDescription = '';
  let searchDescription = '';
  let effectiveMinMs = Infinity;
  let effectiveMaxMs = -Infinity;

  // =========================================================================
  // MODE 1A: CROSS-TIMEFRAME — PARENT PERIOD WINDOW ALIGNMENT
  // =========================================================================
  if (
    config.mode === 'cross' &&
    config.crossStrategy === 'parent_window' &&
    TIMEFRAME_MAP[searchTf].rankOrder < TIMEFRAME_MAP[config.targetTimeframe].rankOrder
  ) {
    targetDescription = `${config.targetTimeframe} Parent Candle`;
    searchDescription = `All ${searchTf} Slots Inside ${config.targetTimeframe}`;

    // Two-pointer O(N + M) alignment over sorted ascending arrays
    let tIdx = 0;
    const matchedTargetIds = new Set<number>();
    const validTargetIds = new Set<number>();
    const dojiTargetIds = new Set<number>();

    for (let sIdx = 0; sIdx < searchCandles.length; sIdx++) {
      const principal = searchCandles[sIdx];

      while (
        tIdx < targetCandles.length &&
        getCandleEndMs(targetCandles[tIdx].timestamp, config.targetTimeframe) <= principal.timestamp
      ) {
        tIdx++;
      }

      if (tIdx >= targetCandles.length) break;

      const target = targetCandles[tIdx];
      const targetEnd = getCandleEndMs(target.timestamp, config.targetTimeframe);

      if (principal.timestamp >= target.timestamp && principal.timestamp < targetEnd) {
        matchedTargetIds.add(target.timestamp);
        if (target.candleType === 'DOJI') {
          dojiTargetIds.add(target.timestamp);
        } else {
          validTargetIds.add(target.timestamp);
        }

        if (target.timestamp < effectiveMinMs) effectiveMinMs = target.timestamp;
        if (target.timestamp > effectiveMaxMs) effectiveMaxMs = target.timestamp;

        const slot = getParentChildSlot(
          principal.timestamp,
          target.timestamp,
          config.targetTimeframe,
          searchTf
        );
        const cycleDateStr = formatUtcDateIso(target.timestamp);
        const { isDojiExcluded } = recordPair(
          accMap,
          slot.slotKey,
          slot.slotLabel,
          slot.sortOrder,
          `${target.timestamp}`,
          cycleDateStr,
          target,
          principal,
          config.targetTimeframe,
          searchTf
        );
        if (isDojiExcluded) totalExcludedDojiPairs++;
      }
    }

    totalCyclesScanned = matchedTargetIds.size;
    totalValidCycles = validTargetIds.size;
    totalExcludedTargetDojis = dojiTargetIds.size;
  }
  // =========================================================================
  // MODE 1B / 2A: SPECIFIC TARGET SLOT CYCLE ALIGNMENT (CROSS OR SAME TF)
  // =========================================================================
  else if (
    (config.mode === 'cross' &&
      (config.crossStrategy === 'specific_slot' ||
        TIMEFRAME_MAP[searchTf].rankOrder >= TIMEFRAME_MAP[config.targetTimeframe].rankOrder)) ||
    (config.mode === 'same' && config.sameStrategy === 'specific_slot')
  ) {
    const cycleUnit = resolveCycleUnit(config.targetTimeframe, searchTf);
    const availableSlots = getAvailableSlotsForTimeframe(targetCandles, config.targetTimeframe, searchTf);
    const chosenSlotKey =
      config.targetSlotKey && availableSlots.some((s) => s.key === config.targetSlotKey)
        ? config.targetSlotKey
        : availableSlots[0]?.key ?? null;

    if (!chosenSlotKey) {
      return makeEmptyResult('No valid Target candle slots found in the selected date range.');
    }

    const chosenSlotLabel = availableSlots.find((s) => s.key === chosenSlotKey)?.label ?? chosenSlotKey;
    targetDescription = `${config.targetTimeframe} · ${chosenSlotLabel}`;
    searchDescription =
      config.mode === 'same'
        ? `Other ${searchTf} Slots (${cycleUnit} cycle)`
        : `All ${searchTf} Slots (${cycleUnit} cycle)`;

    // Index target candles by cycleKey for the chosen target slot
    const targetByCycle = new Map<string, { candle: EnrichedCandle; cycleDateStr: string }>();
    for (let i = 0; i < targetCandles.length; i++) {
      const c = targetCandles[i];
      const info = getCycleAndSlot(c.timestamp, config.targetTimeframe, cycleUnit);
      if (info.slotKey === chosenSlotKey) {
        targetByCycle.set(info.cycleKey, { candle: c, cycleDateStr: info.cycleDateStr });
      }
    }

    const matchedCycles = new Set<string>();
    const validCycles = new Set<string>();
    const dojiCycles = new Set<string>();

    for (let i = 0; i < searchCandles.length; i++) {
      const principal = searchCandles[i];
      const pInfo = getCycleAndSlot(principal.timestamp, searchTf, cycleUnit);

      // In same-timeframe mode, skip self-comparison
      if (config.mode === 'same' && pInfo.slotKey === chosenSlotKey) {
        continue;
      }

      const targetEntry = targetByCycle.get(pInfo.cycleKey);
      if (!targetEntry) continue;

      const target = targetEntry.candle;
      matchedCycles.add(pInfo.cycleKey);
      if (target.candleType === 'DOJI') {
        dojiCycles.add(pInfo.cycleKey);
      } else {
        validCycles.add(pInfo.cycleKey);
      }

      if (target.timestamp < effectiveMinMs) effectiveMinMs = target.timestamp;
      if (target.timestamp > effectiveMaxMs) effectiveMaxMs = target.timestamp;

      const { isDojiExcluded } = recordPair(
        accMap,
        pInfo.slotKey,
        pInfo.slotLabel,
        pInfo.sortOrder,
        pInfo.cycleKey,
        targetEntry.cycleDateStr,
        target,
        principal,
        config.targetTimeframe,
        searchTf
      );
      if (isDojiExcluded) totalExcludedDojiPairs++;
    }

    totalCyclesScanned = matchedCycles.size;
    totalValidCycles = validCycles.size;
    totalExcludedTargetDojis = dojiCycles.size;
  }
  // =========================================================================
  // MODE 2B: SAME-TIMEFRAME RELATIVE CANDLE OFFSET (Target - N / Target + N)
  // =========================================================================
  else {
    const maxLag = Math.max(1, Math.min(120, Math.floor(config.maxLagCandles || 12)));
    const cycleUnit = resolveCycleUnit(config.targetTimeframe, config.targetTimeframe);
    const hasSlotFilter = Boolean(config.targetSlotKey && config.targetSlotKey !== '__ALL__');
    let slotFilterLabel = 'Every Candle';

    if (hasSlotFilter) {
      const slots = getAvailableSlotsForTimeframe(targetCandles, config.targetTimeframe, config.targetTimeframe);
      slotFilterLabel = slots.find((s) => s.key === config.targetSlotKey)?.label ?? config.targetSlotKey!;
    }

    targetDescription = `${config.targetTimeframe} · ${slotFilterLabel}`;
    searchDescription = config.includeLeadOffsets
      ? `Relative Offsets (-${maxLag} to +${maxLag} candles)`
      : `Prior Candles (Target - 1 to Target - ${maxLag})`;

    // Build index map on full searchDs (sorted) so lookbacks cross filterStartMs cleanly
    const fullCandles = searchDs.candles;
    const offsets: number[] = [];
    for (let k = maxLag; k >= 1; k--) offsets.push(-k);
    if (config.includeLeadOffsets) {
      for (let k = 1; k <= maxLag; k++) offsets.push(k);
    }

    for (let i = 0; i < fullCandles.length; i++) {
      const target = fullCandles[i];
      if (filterStartMs !== null && target.timestamp < filterStartMs) continue;
      if (filterEndMs !== null && target.timestamp > filterEndMs) continue;

      if (hasSlotFilter) {
        const info = getCycleAndSlot(target.timestamp, config.targetTimeframe, cycleUnit);
        if (info.slotKey !== config.targetSlotKey) continue;
      }

      totalCyclesScanned++;
      if (target.candleType === 'DOJI') {
        totalExcludedTargetDojis++;
      } else {
        totalValidCycles++;
      }

      if (target.timestamp < effectiveMinMs) effectiveMinMs = target.timestamp;
      if (target.timestamp > effectiveMaxMs) effectiveMaxMs = target.timestamp;

      const cycleDateStr = target.timeStr;

      for (let o = 0; o < offsets.length; o++) {
        const offset = offsets[o];
        const pIdx = i + offset;
        if (pIdx < 0 || pIdx >= fullCandles.length) continue;

        const principal = fullCandles[pIdx];
        const absK = Math.abs(offset);
        const slotKey = offset < 0 ? `LAG_${absK}` : `LEAD_${absK}`;
        const slotLabel =
          offset < 0
            ? `Target - ${absK} ${absK === 1 ? 'Candle' : 'Candles'}`
            : `Target + ${absK} ${absK === 1 ? 'Candle' : 'Candles'}`;

        const { isDojiExcluded } = recordPair(
          accMap,
          slotKey,
          slotLabel,
          offset,
          `${target.timestamp}`,
          cycleDateStr,
          target,
          principal,
          config.targetTimeframe,
          searchTf
        );
        if (isDojiExcluded) totalExcludedDojiPairs++;
      }
    }
  }

  const candidates = finalizeCandidates(accMap, searchTf);

  let warningMessage: string | null = null;
  if (candidates.length === 0) {
    warningMessage =
      'No aligned candle pairs were found for the chosen configuration and date window.';
  } else if (candidates.every((c) => c.totalValidPairs === 0)) {
    warningMessage =
      'All aligned candle pairs in this window were excluded because either the Target or Principal candle was a DOJI.';
  }

  const computeDurationMs = Math.max(
    0,
    Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
  );

  return {
    config,
    targetDescription,
    searchDescription,
    overlapStartUtc: overlapStartIso,
    overlapEndUtc: overlapEndIso,
    effectiveStartUtc: Number.isFinite(effectiveMinMs) ? formatUtcDateIso(effectiveMinMs) : overlapStartIso,
    effectiveEndUtc: Number.isFinite(effectiveMaxMs) ? formatUtcDateIso(effectiveMaxMs) : overlapEndIso,
    totalCyclesScanned,
    totalValidCycles,
    totalExcludedTargetDojis,
    totalExcludedDojiPairs,
    candidates,
    warningMessage,
    computedAtUtc,
    computeDurationMs,
  };
}

/**
 * Returns the active metric score (%) for a candidate under the selected DirectionFilter.
 */
export function getDirectionScore(
  candidate: PrincipalCandidateResult,
  direction: ResultsFilterState['directionFilter']
): number | null {
  if (direction === 'bullish') return candidate.bullishMatchRate;
  if (direction === 'bearish') return candidate.bearishMatchRate;
  return candidate.totalValidPairs > 0 ? candidate.overallAlignmentScore : null;
}

/**
 * Applies interactive dashboard filters (search query, min alignment %, min sample size N,
 * direction filter, before-close-only toggle) and re-ranks deterministically.
 */
export function filterAndRankCandidates(
  candidates: PrincipalCandidateResult[],
  filters: ResultsFilterState
): PrincipalCandidateResult[] {
  const query = filters.searchQuery.trim().toLowerCase();

  const filtered = candidates.filter((c) => {
    if (query && !c.slotLabel.toLowerCase().includes(query) && !c.searchTimeframe.toLowerCase().includes(query)) {
      return false;
    }
    if (c.totalValidPairs < filters.minSampleSize) {
      return false;
    }
    if (filters.beforeCloseOnly && c.timingRelation !== 'BEFORE') {
      return false;
    }
    const metric = getDirectionScore(c, filters.directionFilter);
    if (metric === null) {
      return filters.minAlignmentPct <= 0;
    }
    if (metric < filters.minAlignmentPct) {
      return false;
    }
    return true;
  });

  // Sort by active direction metric DESC -> Sample Size N DESC -> Slot Sort Order ASC
  return filtered.slice().sort((a, b) => {
    const scoreA = getDirectionScore(a, filters.directionFilter) ?? -1;
    const scoreB = getDirectionScore(b, filters.directionFilter) ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (b.totalValidPairs !== a.totalValidPairs) return b.totalValidPairs - a.totalValidPairs;
    return a.slotSortOrder - b.slotSortOrder;
  });
}

// ============================================================================
// Best Matched Candles Search Engine (Mode A: Multi-TF & Mode B: Single-File)
// ============================================================================

export function getLoadedTimeframeIds(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>
): TimeframeId[] {
  return TIMEFRAMES.map((t) => t.id).filter(
    (id) => Boolean(datasets[id] && datasets[id]!.candles.length > 0)
  );
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Computes normalized OHLC geometry + rolling ATR(14) + rolling Volume(20) ratios
 * in a single O(N) deterministic pass with strict division-by-zero protection.
 */
export function computeDatasetFeatures(candles: EnrichedCandle[]): CandleGeometryFeatures[] {
  const n = candles.length;
  const out = new Array<CandleGeometryFeatures>(n);
  const ranges = new Float64Array(n);
  let rangeSum14 = 0;
  let volSum20 = 0;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const range = Math.max(0, c.high - c.low);
    ranges[i] = range;

    rangeSum14 += range;
    if (i >= 14) rangeSum14 -= ranges[i - 14];
    const atrPeriod = Math.min(i + 1, 14);
    const atr14 = atrPeriod > 0 ? rangeSum14 / atrPeriod : 0;

    const safeVol = Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0;
    volSum20 += safeVol;
    if (i >= 20) {
      const prevVol = candles[i - 20].volume;
      volSum20 -= Number.isFinite(prevVol) && prevVol > 0 ? prevVol : 0;
    }
    const volPeriod = Math.min(i + 1, 20);
    const avgVol20 = volPeriod > 0 ? volSum20 / volPeriod : 0;

    const bodySize = Math.abs(c.close - c.open);
    const bodyTop = c.open >= c.close ? c.open : c.close;
    const bodyBottom = c.open <= c.close ? c.open : c.close;
    const upperWick = Math.max(0, c.high - bodyTop);
    const lowerWick = Math.max(0, bodyBottom - c.low);

    const bodyRatio = range > 0 ? clamp01(bodySize / range) : 0;
    const upperWickRatio = range > 0 ? clamp01(upperWick / range) : 0;
    const lowerWickRatio = range > 0 ? clamp01(lowerWick / range) : 0;
    const rangeAtrRatio = atr14 > 0 ? range / atr14 : range > 0 ? 1 : 0;
    const volumeRatio = avgVol20 > 0 ? safeVol / avgVol20 : 1;

    out[i] = {
      range,
      bodySize,
      bodyRatio,
      upperWickRatio,
      lowerWickRatio,
      atr14,
      rangeAtrRatio,
      volumeRatio,
    };
  }

  return out;
}

function pairPolarityAgreement(a: CandleType, b: CandleType): number {
  if (a === b) {
    return a === 'DOJI' ? 0.5 : 1.0;
  }
  if (a === 'DOJI' || b === 'DOJI') {
    return 0.35;
  }
  return 0.0;
}

function featurePairSimilarity(a: CandleGeometryFeatures, b: CandleGeometryFeatures): number {
  const atrNormA = Math.min(3, Math.max(0, a.rangeAtrRatio)) / 3;
  const atrNormB = Math.min(3, Math.max(0, b.rangeAtrRatio)) / 3;
  const dist =
    0.35 * Math.abs(a.bodyRatio - b.bodyRatio) +
    0.225 * Math.abs(a.upperWickRatio - b.upperWickRatio) +
    0.225 * Math.abs(a.lowerWickRatio - b.lowerWickRatio) +
    0.2 * Math.abs(atrNormA - atrNormB);
  return clamp01(1 - dist);
}

function volumePairSimilarity(a: CandleGeometryFeatures, b: CandleGeometryFeatures): number {
  const va = Math.min(4, Math.max(0, a.volumeRatio)) / 4;
  const vb = Math.min(4, Math.max(0, b.volumeRatio)) / 4;
  return clamp01(1 - Math.abs(va - vb));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface TopMatchCandidate<T> {
  score: number;
  tieBreaker: number;
  timestamp: number;
  payload: T;
}

function insertBoundedTop<T>(
  heap: TopMatchCandidate<T>[],
  item: TopMatchCandidate<T>,
  limit: number
): void {
  if (heap.length < limit) {
    heap.push(item);
    return;
  }
  // Find weakest entry
  let minIdx = 0;
  for (let i = 1; i < heap.length; i++) {
    const cur = heap[i];
    const min = heap[minIdx];
    if (
      cur.score < min.score ||
      (cur.score === min.score &&
        (cur.tieBreaker < min.tieBreaker ||
          (cur.tieBreaker === min.tieBreaker && cur.timestamp < min.timestamp)))
    ) {
      minIdx = i;
    }
  }
  const weakest = heap[minIdx];
  if (
    item.score > weakest.score ||
    (item.score === weakest.score &&
      (item.tieBreaker > weakest.tieBreaker ||
        (item.tieBreaker === weakest.tieBreaker && item.timestamp > weakest.timestamp)))
  ) {
    heap[minIdx] = item;
  }
}

function sortTopCandidates<T>(items: TopMatchCandidate<T>[]): TopMatchCandidate<T>[] {
  return items.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.tieBreaker !== a.tieBreaker) return b.tieBreaker - a.tieBreaker;
    return b.timestamp - a.timestamp;
  });
}

function computeMultiTfTupleScores(
  candles: EnrichedCandle[],
  features: CandleGeometryFeatures[]
): {
  matchScore: number;
  directionalScore: number;
  structuralScore: number;
  dominantDirection: CandleType;
  bullCount: number;
  bearCount: number;
  dojiCount: number;
} {
  const m = candles.length;
  let bullCount = 0;
  let bearCount = 0;
  let dojiCount = 0;

  for (let i = 0; i < m; i++) {
    if (candles[i].candleType === 'BULLISH') bullCount++;
    else if (candles[i].candleType === 'BEARISH') bearCount++;
    else dojiCount++;
  }

  let dirPairs = 0;
  let dirSum = 0;
  let structSum = 0;

  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      dirPairs++;
      dirSum += pairPolarityAgreement(candles[i].candleType, candles[j].candleType);
      structSum += featurePairSimilarity(features[i], features[j]);
    }
  }

  const directionalScore = dirPairs > 0 ? (dirSum / dirPairs) * 100 : 0;
  const structuralScore = dirPairs > 0 ? (structSum / dirPairs) * 100 : 0;
  // 55% Directional Alignment + 45% Structural Similarity
  const matchScore = 0.55 * directionalScore + 0.45 * structuralScore;

  let dominantDirection: CandleType = 'DOJI';
  if (bullCount > bearCount && bullCount > 0) dominantDirection = 'BULLISH';
  else if (bearCount > bullCount && bearCount > 0) dominantDirection = 'BEARISH';
  else if (bullCount === bearCount && bullCount > 0) dominantDirection = candles[m - 1].candleType;

  return {
    matchScore: round2(matchScore),
    directionalScore: round2(directionalScore),
    structuralScore: round2(structuralScore),
    dominantDirection,
    bullCount,
    bearCount,
    dojiCount,
  };
}

/**
 * Mode A: Cross-Timeframe Best Matched Candles Search across any 2+ selected timeframes.
 */
export function runMultiTimeframeMatchSearchFromCandles(
  candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>>,
  config: BestMatchConfig,
  onProgress?: (progress: BestMatchProgress) => void,
  usedWorker = false
): BestMatchResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const computedAtUtc = formatUtcTimestamp(Date.now());

  const selectedSorted = Array.from(new Set(config.selectedTimeframes))
    .filter((tf) => Boolean(candlesByTf[tf] && candlesByTf[tf]!.length > 0))
    .sort((a, b) => TIMEFRAME_MAP[a].rankOrder - TIMEFRAME_MAP[b].rankOrder);

  const makeEmpty = (warningMessage: string): BestMatchResult => ({
    config,
    scope: 'multi_tf',
    activeTimeframes: selectedSorted,
    referenceSnapshots: null,
    totalCandidatesScanned: 0,
    totalAboveThreshold: 0,
    effectiveStartUtc: null,
    effectiveEndUtc: null,
    matches: [],
    warningMessage,
    computedAtUtc,
    computeDurationMs: Math.max(
      0,
      Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
    ),
    usedWorker,
  });

  if (selectedSorted.length < 2) {
    return makeEmpty('Select at least 2 uploaded timeframes to run Cross-Timeframe Match Search.');
  }

  const filterStartMs = config.startDateUtc ? parseIsoDateStartUtcMs(config.startDateUtc) : null;
  const filterEndMs = config.endDateUtc ? parseIsoDateEndUtcMs(config.endDateUtc) : null;

  if (filterStartMs !== null && filterEndMs !== null && filterStartMs > filterEndMs) {
    return makeEmpty('Start UTC date cannot be after End UTC date.');
  }

  // Compute global overlap across all selected timeframes
  let overlapStartMs = -Infinity;
  let overlapEndMs = Infinity;
  for (const tf of selectedSorted) {
    const arr = candlesByTf[tf]!;
    const first = arr[0].timestamp;
    const lastEnd = getCandleEndMs(arr[arr.length - 1].timestamp, tf) - 1;
    if (first > overlapStartMs) overlapStartMs = first;
    if (lastEnd < overlapEndMs) overlapEndMs = lastEnd;
  }

  if (overlapStartMs > overlapEndMs) {
    return makeEmpty(
      `Non-overlapping UTC date ranges across selected timeframes (${selectedSorted.join(', ')}). Adjust selected timeframes or upload overlapping data.`
    );
  }

  const effectiveBoundStart =
    filterStartMs !== null ? Math.max(overlapStartMs, filterStartMs) : overlapStartMs;
  const effectiveBoundEnd =
    filterEndMs !== null ? Math.min(overlapEndMs, filterEndMs) : overlapEndMs;

  if (effectiveBoundStart > effectiveBoundEnd) {
    return makeEmpty('No aligned candles fall within the chosen UTC date filter.');
  }

  onProgress?.({ percent: 10, scanned: 0, total: 100, stage: 'indexing' });

  const featureMap: Partial<Record<TimeframeId, CandleGeometryFeatures[]>> = {};
  for (const tf of selectedSorted) {
    featureMap[tf] = computeDatasetFeatures(candlesByTf[tf]!);
  }

  const lowestTf = selectedSorted[0];
  const highestTf = selectedSorted[selectedSorted.length - 1];
  const anchorTf = config.multiTfAnchor === 'parent_window' ? highestTf : lowestTf;
  const anchorCandles = candlesByTf[anchorTf]!;
  const ptrs = new Array<number>(selectedSorted.length).fill(0);

  const bounded: TopMatchCandidate<{ indices: number[]; endMs: number }>[] = [];
  const keepLimit = Math.max(config.maxResults * 3, 150);

  let totalCandidatesScanned = 0;
  let totalAboveThreshold = 0;
  let minMatchedTs = Infinity;
  let maxMatchedTs = -Infinity;

  const totalAnchorCount = anchorCandles.length;
  const progressStep = Math.max(500, Math.floor(totalAnchorCount / 25));

  for (let aIdx = 0; aIdx < totalAnchorCount; aIdx++) {
    const anchor = anchorCandles[aIdx];
    const anchorEndMs = getCandleEndMs(anchor.timestamp, anchorTf);

    if (anchorEndMs - 1 < effectiveBoundStart) continue;
    if (anchor.timestamp > effectiveBoundEnd) break;

    if (aIdx % progressStep === 0) {
      const pct = 15 + Math.round((aIdx / Math.max(1, totalAnchorCount)) * 75);
      onProgress?.({ percent: pct, scanned: aIdx, total: totalAnchorCount, stage: 'scoring' });
    }

    const tupleIndices = new Array<number>(selectedSorted.length);
    let allAligned = true;

    if (config.multiTfAnchor === 'lowest_tf') {
      // Anchor = lowest selected TF bar; find active enclosing bar in every higher TF
      for (let k = 0; k < selectedSorted.length; k++) {
        if (k === 0) {
          tupleIndices[k] = aIdx;
          continue;
        }
        const tf = selectedSorted[k];
        const arr = candlesByTf[tf]!;
        let p = ptrs[k];
        while (p < arr.length && getCandleEndMs(arr[p].timestamp, tf) <= anchor.timestamp) {
          p++;
        }
        ptrs[k] = p;
        if (p >= arr.length || arr[p].timestamp > anchor.timestamp) {
          allAligned = false;
          break;
        }
        tupleIndices[k] = p;
      }
    } else {
      // Anchor = highest selected parent window; find latest closing bar of each child TF inside [anchorStart, anchorEnd)
      for (let k = 0; k < selectedSorted.length; k++) {
        if (k === selectedSorted.length - 1) {
          tupleIndices[k] = aIdx;
          continue;
        }
        const tf = selectedSorted[k];
        const arr = candlesByTf[tf]!;
        let p = ptrs[k];
        while (p < arr.length && arr[p].timestamp < anchor.timestamp) {
          p++;
        }
        let lastInside = -1;
        while (p < arr.length && arr[p].timestamp < anchorEndMs) {
          lastInside = p;
          p++;
        }
        // Keep pointer near lastInside so overlapping steps don't miss
        ptrs[k] = lastInside >= 0 ? lastInside : p;
        if (lastInside === -1) {
          allAligned = false;
          break;
        }
        tupleIndices[k] = lastInside;
      }
    }

    if (!allAligned) continue;

    totalCandidatesScanned++;
    if (anchor.timestamp < minMatchedTs) minMatchedTs = anchor.timestamp;
    if (anchor.timestamp > maxMatchedTs) maxMatchedTs = anchor.timestamp;

    const tupleCandles = selectedSorted.map((tf, k) => candlesByTf[tf]![tupleIndices[k]]);
    const tupleFeatures = selectedSorted.map((tf, k) => featureMap[tf]![tupleIndices[k]]);
    const scores = computeMultiTfTupleScores(tupleCandles, tupleFeatures);

    if (scores.matchScore >= config.minMatchScore) {
      totalAboveThreshold++;
      insertBoundedTop(
        bounded,
        {
          score: scores.matchScore,
          tieBreaker: scores.structuralScore,
          timestamp: anchor.timestamp,
          payload: { indices: tupleIndices, endMs: anchorEndMs },
        },
        keepLimit
      );
    }
  }

  onProgress?.({ percent: 95, scanned: totalAnchorCount, total: totalAnchorCount, stage: 'ranking' });

  const sortedTop = sortTopCandidates(bounded).slice(0, config.maxResults);
  const matches: BestMatchItem[] = sortedTop.map((entry, idx) => {
    const anchor = anchorCandles[
      config.multiTfAnchor === 'parent_window'
        ? entry.payload.indices[selectedSorted.length - 1]
        : entry.payload.indices[0]
    ];
    const tupleCandles = selectedSorted.map((tf, k) => candlesByTf[tf]![entry.payload.indices[k]]);
    const tupleFeatures = selectedSorted.map((tf, k) => featureMap[tf]![entry.payload.indices[k]]);
    const scores = computeMultiTfTupleScores(tupleCandles, tupleFeatures);

    const dirName =
      scores.dominantDirection === 'BULLISH'
        ? 'Bullish'
        : scores.dominantDirection === 'BEARISH'
          ? 'Bearish'
          : 'Neutral';

    const snapshots: MatchedCandleSnapshot[] = selectedSorted.map((tf, k) => ({
      timeframe: tf,
      roleLabel: tf,
      candle: tupleCandles[k],
      features: tupleFeatures[k],
    }));

    const consensusText =
      scores.bullCount === selectedSorted.length
        ? `All ${selectedSorted.length} TFs Bullish`
        : scores.bearCount === selectedSorted.length
          ? `All ${selectedSorted.length} TFs Bearish`
          : `${scores.bullCount} Bull · ${scores.bearCount} Bear${scores.dojiCount > 0 ? ` · ${scores.dojiCount} Doji` : ''}`;

    return {
      id: `mtf_${anchorTf}_${anchor.timestamp}_${idx}`,
      rank: idx + 1,
      anchorTimeframe: anchorTf,
      timestamp: anchor.timestamp,
      timeStr: anchor.timeStr,
      endTimeStr: formatUtcTimestamp(entry.payload.endMs),
      matchScore: scores.matchScore,
      directionalScore: scores.directionalScore,
      structuralScore: scores.structuralScore,
      volumeScore: null,
      dominantDirection: scores.dominantDirection,
      patternLabel: `${selectedSorted.length}-TF ${dirName} Alignment`,
      summaryDetail: `${consensusText} · Structure ${scores.structuralScore.toFixed(1)}%`,
      snapshots,
    };
  });

  onProgress?.({ percent: 100, scanned: totalAnchorCount, total: totalAnchorCount, stage: 'ranking' });

  let warningMessage: string | null = null;
  if (totalCandidatesScanned === 0) {
    warningMessage =
      'No synchronized multi-timeframe windows were found across the selected timeframes and UTC range.';
  } else if (matches.length === 0) {
    warningMessage = `Scanned ${totalCandidatesScanned.toLocaleString()} synchronized multi-timeframe windows, but none met the ${config.minMatchScore}% Min Match Score threshold. Lower the threshold to inspect near-matches.`;
  }

  const computeDurationMs = Math.max(
    0,
    Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
  );

  return {
    config,
    scope: 'multi_tf',
    activeTimeframes: selectedSorted,
    referenceSnapshots: null,
    totalCandidatesScanned,
    totalAboveThreshold,
    effectiveStartUtc: Number.isFinite(minMatchedTs) ? formatUtcDateIso(minMatchedTs) : formatUtcDateIso(effectiveBoundStart),
    effectiveEndUtc: Number.isFinite(maxMatchedTs) ? formatUtcDateIso(maxMatchedTs) : formatUtcDateIso(effectiveBoundEnd),
    matches,
    warningMessage,
    computedAtUtc,
    computeDurationMs,
    usedWorker,
  };
}

/**
 * Mode B: Single-File / Intra-Timeframe Pattern Match Search (Reference Sequence or Auto-Scan).
 * Works cleanly even when only 1 CSV file is uploaded.
 */
export function runSingleFileMatchSearchFromCandles(
  candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>>,
  config: BestMatchConfig,
  onProgress?: (progress: BestMatchProgress) => void,
  usedWorker = false
): BestMatchResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const computedAtUtc = formatUtcTimestamp(Date.now());
  const tf = config.singleTimeframe;
  const candles = candlesByTf[tf] ?? [];

  const makeEmpty = (warningMessage: string, refSnapshots: MatchedCandleSnapshot[] | null = null): BestMatchResult => ({
    config,
    scope: 'single_file',
    activeTimeframes: candles.length > 0 ? [tf] : [],
    referenceSnapshots: refSnapshots,
    totalCandidatesScanned: 0,
    totalAboveThreshold: 0,
    effectiveStartUtc: null,
    effectiveEndUtc: null,
    matches: [],
    warningMessage,
    computedAtUtc,
    computeDurationMs: Math.max(
      0,
      Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
    ),
    usedWorker,
  });

  if (candles.length === 0) {
    return makeEmpty(`Selected timeframe ${tf} has no uploaded candles.`);
  }

  const kLen = Math.max(1, Math.min(3, config.sequenceLength)) as 1 | 2 | 3;
  if (candles.length < kLen + 1 && config.singleSubMode === 'reference') {
    return makeEmpty(`Need at least ${kLen + 1} candles in ${tf} to match a ${kLen}-candle reference sequence.`);
  }
  if (candles.length < kLen) {
    return makeEmpty(`Need at least ${kLen} candles in ${tf} for sequence length K=${kLen}.`);
  }

  const filterStartMs = config.startDateUtc ? parseIsoDateStartUtcMs(config.startDateUtc) : null;
  const filterEndMs = config.endDateUtc ? parseIsoDateEndUtcMs(config.endDateUtc) : null;
  if (filterStartMs !== null && filterEndMs !== null && filterStartMs > filterEndMs) {
    return makeEmpty('Start UTC date cannot be after End UTC date.');
  }

  onProgress?.({ percent: 10, scanned: 0, total: candles.length, stage: 'indexing' });
  const features = computeDatasetFeatures(candles);

  // =========================================================================
  // SUB-MODE B1: TARGET REFERENCE CANDLE / SEQUENCE (K = 1, 2, 3)
  // =========================================================================
  if (config.singleSubMode === 'reference') {
    let refIdx = candles.length - kLen;
    if (config.referenceTimestamp !== null) {
      const exactIdx = candles.findIndex((c) => c.timestamp === config.referenceTimestamp);
      if (exactIdx !== -1) {
        refIdx = Math.min(exactIdx, candles.length - kLen);
      }
    }

    const refSnapshots: MatchedCandleSnapshot[] = [];
    for (let p = 0; p < kLen; p++) {
      refSnapshots.push({
        timeframe: tf,
        roleLabel: kLen === 1 ? tf : `Ref Bar ${p + 1}/${kLen}`,
        candle: candles[refIdx + p],
        features: features[refIdx + p],
      });
    }

    // Reference multi-bar close progression (normalized by ATR)
    const refStepDeltas: number[] = [];
    for (let p = 1; p < kLen; p++) {
      const baseAtr = Math.max(1e-8, features[refIdx + p].atr14, Math.abs(candles[refIdx + p - 1].close) * 0.002);
      refStepDeltas.push((candles[refIdx + p].close - candles[refIdx + p - 1].close) / baseAtr);
    }

    const keepLimit = Math.max(config.maxResults * 3, 150);
    const bounded: TopMatchCandidate<{
      startIdx: number;
      directionalScore: number;
      structuralScore: number;
      volumeScore: number | null;
      dominantDirection: CandleType;
    }>[] = [];

    const maxStart = candles.length - kLen;
    const progressStep = Math.max(1000, Math.floor(maxStart / 25));

    let totalCandidatesScanned = 0;
    let totalAboveThreshold = 0;
    let minTs = Infinity;
    let maxTs = -Infinity;

    for (let i = 0; i <= maxStart; i++) {
      // Exclude windows that overlap the reference window itself
      if (!(i + kLen - 1 < refIdx || i > refIdx + kLen - 1)) continue;

      const winStart = candles[i].timestamp;
      const winEnd = candles[i + kLen - 1].timestamp;
      if (filterStartMs !== null && winStart < filterStartMs) continue;
      if (filterEndMs !== null && winEnd > filterEndMs) continue;

      if (i % progressStep === 0) {
        const pct = 15 + Math.round((i / Math.max(1, maxStart)) * 75);
        onProgress?.({ percent: pct, scanned: i, total: maxStart + 1, stage: 'scoring' });
      }

      totalCandidatesScanned++;
      if (winStart < minTs) minTs = winStart;
      if (winEnd > maxTs) maxTs = winEnd;

      let dirSum = 0;
      let structSum = 0;
      let volSum = 0;

      for (let p = 0; p < kLen; p++) {
        const cCand = candles[i + p];
        const rCand = candles[refIdx + p];
        const cFeat = features[i + p];
        const rFeat = features[refIdx + p];

        dirSum += pairPolarityAgreement(cCand.candleType, rCand.candleType);
        structSum += featurePairSimilarity(cFeat, rFeat);
        if (config.includeVolumeWeight) {
          volSum += volumePairSimilarity(cFeat, rFeat);
        }
      }

      let transitionSim = 1;
      if (kLen > 1) {
        let transSum = 0;
        for (let p = 1; p < kLen; p++) {
          const baseAtr = Math.max(1e-8, features[i + p].atr14, Math.abs(candles[i + p - 1].close) * 0.002);
          const candDelta = (candles[i + p].close - candles[i + p - 1].close) / baseAtr;
          const refDelta = refStepDeltas[p - 1];
          const diff = Math.min(2.5, Math.abs(candDelta - refDelta)) / 2.5;
          transSum += 1 - diff;
        }
        transitionSim = transSum / (kLen - 1);
      }

      const directionalScore = (dirSum / kLen) * 100;
      const shapeScore = (structSum / kLen) * 100;
      const structuralScore = kLen > 1 ? 0.8 * shapeScore + 0.2 * (transitionSim * 100) : shapeScore;
      const volumeScore = config.includeVolumeWeight ? (volSum / kLen) * 100 : null;

      const matchScore =
        volumeScore !== null
          ? 0.4 * directionalScore + 0.45 * structuralScore + 0.15 * volumeScore
          : 0.45 * directionalScore + 0.55 * structuralScore;

      const roundedMatch = round2(matchScore);
      if (roundedMatch >= config.minMatchScore) {
        totalAboveThreshold++;
        const netDiff = candles[i + kLen - 1].close - candles[i].open;
        const dominantDirection: CandleType =
          netDiff > 0 ? 'BULLISH' : netDiff < 0 ? 'BEARISH' : candles[i].candleType;

        insertBoundedTop(
          bounded,
          {
            score: roundedMatch,
            tieBreaker: round2(structuralScore),
            timestamp: winStart,
            payload: {
              startIdx: i,
              directionalScore: round2(directionalScore),
              structuralScore: round2(structuralScore),
              volumeScore: volumeScore !== null ? round2(volumeScore) : null,
              dominantDirection,
            },
          },
          keepLimit
        );
      }
    }

    onProgress?.({ percent: 95, scanned: maxStart + 1, total: maxStart + 1, stage: 'ranking' });

    const sortedTop = sortTopCandidates(bounded).slice(0, config.maxResults);
    const matches: BestMatchItem[] = sortedTop.map((entry, idx) => {
      const sIdx = entry.payload.startIdx;
      const snapshots: MatchedCandleSnapshot[] = [];
      for (let p = 0; p < kLen; p++) {
        snapshots.push({
          timeframe: tf,
          roleLabel: kLen === 1 ? tf : `Bar ${p + 1}/${kLen}`,
          candle: candles[sIdx + p],
          features: features[sIdx + p],
        });
      }

      const first = candles[sIdx];
      const last = candles[sIdx + kLen - 1];
      const avgBody =
        snapshots.reduce((acc, s) => acc + s.features.bodyRatio, 0) / snapshots.length;

      return {
        id: `sf_ref_${tf}_${first.timestamp}_${idx}`,
        rank: idx + 1,
        anchorTimeframe: tf,
        timestamp: first.timestamp,
        timeStr: first.timeStr,
        endTimeStr: formatUtcTimestamp(getCandleEndMs(last.timestamp, tf)),
        matchScore: entry.score,
        directionalScore: entry.payload.directionalScore,
        structuralScore: entry.payload.structuralScore,
        volumeScore: entry.payload.volumeScore,
        dominantDirection: entry.payload.dominantDirection,
        patternLabel: kLen === 1 ? `1-Bar Pattern Match` : `${kLen}-Bar Sequence Match`,
        summaryDetail: `Shape ${entry.payload.structuralScore.toFixed(1)}% · Avg Body ${(avgBody * 100).toFixed(0)}%${entry.payload.volumeScore !== null ? ` · Vol ${entry.payload.volumeScore.toFixed(0)}%` : ''}`,
        snapshots,
      };
    });

    onProgress?.({ percent: 100, scanned: maxStart + 1, total: maxStart + 1, stage: 'ranking' });

    let warningMessage: string | null = null;
    if (totalCandidatesScanned === 0) {
      warningMessage = 'No historical candidate windows exist outside the reference candle inside the selected UTC filter.';
    } else if (matches.length === 0) {
      warningMessage = `Scanned ${totalCandidatesScanned.toLocaleString()} candidate windows in ${tf}, but none met the ${config.minMatchScore}% Min Match Score threshold.`;
    }

    const computeDurationMs = Math.max(
      0,
      Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
    );

    return {
      config,
      scope: 'single_file',
      activeTimeframes: [tf],
      referenceSnapshots: refSnapshots,
      totalCandidatesScanned,
      totalAboveThreshold,
      effectiveStartUtc: Number.isFinite(minTs) ? formatUtcDateIso(minTs) : null,
      effectiveEndUtc: Number.isFinite(maxTs) ? formatUtcDateIso(maxTs) : null,
      matches,
      warningMessage,
      computedAtUtc,
      computeDurationMs,
      usedWorker,
    };
  }

  // =========================================================================
  // SUB-MODE B2: TOP-DOWN BEST STRUCTURAL MATCHES (AUTO-SCAN)
  // =========================================================================
  const maxStart = candles.length - kLen;
  const keepLimit = Math.max(config.maxResults * 4, 200);
  const progressStep = Math.max(1000, Math.floor(maxStart / 25));

  const bounded: TopMatchCandidate<{
    startIdx: number;
    directionalScore: number;
    structuralScore: number;
    volumeScore: number | null;
    dominantDirection: CandleType;
    archetype: string;
    detail: string;
  }>[] = [];

  let totalCandidatesScanned = 0;
  let totalAboveThreshold = 0;
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (let i = 0; i <= maxStart; i++) {
    const winStart = candles[i].timestamp;
    const winEnd = candles[i + kLen - 1].timestamp;
    if (filterStartMs !== null && winStart < filterStartMs) continue;
    if (filterEndMs !== null && winEnd > filterEndMs) continue;

    if (i % progressStep === 0) {
      const pct = 15 + Math.round((i / Math.max(1, maxStart)) * 75);
      onProgress?.({ percent: pct, scanned: i, total: maxStart + 1, stage: 'scoring' });
    }

    totalCandidatesScanned++;
    if (winStart < minTs) minTs = winStart;
    if (winEnd > maxTs) maxTs = winEnd;

    if (kLen === 1) {
      const c = candles[i];
      const f = features[i];
      if (f.range <= 0 || c.candleType === 'DOJI') continue;

      // Archetype 1: High-Conviction Momentum Body (minimal opposing wicks + healthy ATR expansion)
      const atrScore = Math.min(1, f.rangeAtrRatio / 1.8);
      const momentumStruct = clamp01(0.65 * f.bodyRatio + 0.35 * atrScore) * 100;

      // Archetype 2: Clean Pin / Rejection Bar (dominant wick >= 60%, compact body)
      const maxWick = Math.max(f.upperWickRatio, f.lowerWickRatio);
      const pinStruct =
        maxWick >= 0.55 && f.bodyRatio <= 0.3
          ? clamp01(0.6 * maxWick + 0.2 * (1 - f.bodyRatio) + 0.2 * atrScore) * 100
          : 0;

      const usePin = pinStruct > momentumStruct;
      const structuralScore = usePin ? pinStruct : momentumStruct;
      const directionalScore = 100;
      const volBoost = clamp01(Math.min(2.5, f.volumeRatio) / 2.5) * 100;
      const volumeScore = config.includeVolumeWeight ? round2(volBoost) : null;

      const composite =
        volumeScore !== null
          ? 0.35 * directionalScore + 0.5 * structuralScore + 0.15 * volumeScore
          : 0.4 * directionalScore + 0.6 * structuralScore;

      const roundedScore = round2(composite);
      if (roundedScore >= config.minMatchScore) {
        totalAboveThreshold++;
        const archetype = usePin
          ? f.lowerWickRatio >= f.upperWickRatio
            ? 'Lower-Wick Rejection Setup'
            : 'Upper-Wick Rejection Setup'
          : c.candleType === 'BULLISH'
            ? 'Strong Bullish Momentum'
            : 'Strong Bearish Momentum';

        insertBoundedTop(
          bounded,
          {
            score: roundedScore,
            tieBreaker: round2(structuralScore),
            timestamp: winStart,
            payload: {
              startIdx: i,
              directionalScore: 100,
              structuralScore: round2(structuralScore),
              volumeScore,
              dominantDirection: c.candleType,
              archetype,
              detail: `Body ${(f.bodyRatio * 100).toFixed(0)}% · Range ${f.rangeAtrRatio.toFixed(2)}x ATR`,
            },
          },
          keepLimit
        );
      }
    } else {
      // K = 2 or 3: Consecutive aligned candles with high symmetry & conviction
      const firstType = candles[i].candleType;
      if (firstType === 'DOJI') continue;

      let allSameDir = true;
      let bodySum = 0;
      let atrSum = 0;
      let volSum = 0;

      for (let p = 0; p < kLen; p++) {
        if (candles[i + p].candleType !== firstType) {
          allSameDir = false;
          break;
        }
        bodySum += features[i + p].bodyRatio;
        atrSum += Math.min(1, features[i + p].rangeAtrRatio / 1.6);
        volSum += clamp01(Math.min(2.5, features[i + p].volumeRatio) / 2.5);
      }

      if (!allSameDir) continue;

      let symPairs = 0;
      let symSum = 0;
      for (let a = 0; a < kLen; a++) {
        for (let b = a + 1; b < kLen; b++) {
          symPairs++;
          symSum += featurePairSimilarity(features[i + a], features[i + b]);
        }
      }

      const avgSym = symPairs > 0 ? symSum / symPairs : 1;
      const avgBody = bodySum / kLen;
      const avgAtr = atrSum / kLen;
      const structuralScore = clamp01(0.45 * avgSym + 0.35 * avgBody + 0.2 * avgAtr) * 100;
      const directionalScore = 100;
      const volumeScore = config.includeVolumeWeight ? round2((volSum / kLen) * 100) : null;

      const composite =
        volumeScore !== null
          ? 0.35 * directionalScore + 0.5 * structuralScore + 0.15 * volumeScore
          : 0.4 * directionalScore + 0.6 * structuralScore;

      const roundedScore = round2(composite);
      if (roundedScore >= config.minMatchScore) {
        totalAboveThreshold++;
        insertBoundedTop(
          bounded,
          {
            score: roundedScore,
            tieBreaker: round2(structuralScore),
            timestamp: winStart,
            payload: {
              startIdx: i,
              directionalScore: 100,
              structuralScore: round2(structuralScore),
              volumeScore,
              dominantDirection: firstType,
              archetype:
                firstType === 'BULLISH'
                  ? `Symmetric ${kLen}-Bar Bullish Run`
                  : `Symmetric ${kLen}-Bar Bearish Run`,
              detail: `Symmetry ${(avgSym * 100).toFixed(0)}% · Avg Body ${(avgBody * 100).toFixed(0)}%`,
            },
          },
          keepLimit
        );
      }
    }
  }

  onProgress?.({ percent: 95, scanned: maxStart + 1, total: maxStart + 1, stage: 'ranking' });

  // Non-overlapping suppression so adjacent overlapping windows don't crowd Top N
  const sortedAll = sortTopCandidates(bounded);
  const picked: typeof sortedAll = [];
  for (let i = 0; i < sortedAll.length && picked.length < config.maxResults; i++) {
    const cand = sortedAll[i];
    const overlapsPicked = picked.some(
      (p) => Math.abs(p.payload.startIdx - cand.payload.startIdx) < kLen
    );
    if (!overlapsPicked) {
      picked.push(cand);
    }
  }

  const matches: BestMatchItem[] = picked.map((entry, idx) => {
    const sIdx = entry.payload.startIdx;
    const snapshots: MatchedCandleSnapshot[] = [];
    for (let p = 0; p < kLen; p++) {
      snapshots.push({
        timeframe: tf,
        roleLabel: kLen === 1 ? tf : `Bar ${p + 1}/${kLen}`,
        candle: candles[sIdx + p],
        features: features[sIdx + p],
      });
    }
    const first = candles[sIdx];
    const last = candles[sIdx + kLen - 1];

    return {
      id: `sf_auto_${tf}_${first.timestamp}_${idx}`,
      rank: idx + 1,
      anchorTimeframe: tf,
      timestamp: first.timestamp,
      timeStr: first.timeStr,
      endTimeStr: formatUtcTimestamp(getCandleEndMs(last.timestamp, tf)),
      matchScore: entry.score,
      directionalScore: entry.payload.directionalScore,
      structuralScore: entry.payload.structuralScore,
      volumeScore: entry.payload.volumeScore,
      dominantDirection: entry.payload.dominantDirection,
      patternLabel: entry.payload.archetype,
      summaryDetail: entry.payload.detail,
      snapshots,
    };
  });

  onProgress?.({ percent: 100, scanned: maxStart + 1, total: maxStart + 1, stage: 'ranking' });

  let warningMessage: string | null = null;
  if (totalCandidatesScanned === 0) {
    warningMessage = `No candidate candles found in ${tf} within the selected UTC range.`;
  } else if (matches.length === 0) {
    warningMessage = `Scanned ${totalCandidatesScanned.toLocaleString()} windows in ${tf}, but none reached the ${config.minMatchScore}% Min Match Score threshold.`;
  }

  const computeDurationMs = Math.max(
    0,
    Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
  );

  return {
    config,
    scope: 'single_file',
    activeTimeframes: [tf],
    referenceSnapshots: null,
    totalCandidatesScanned,
    totalAboveThreshold,
    effectiveStartUtc: Number.isFinite(minTs) ? formatUtcDateIso(minTs) : null,
    effectiveEndUtc: Number.isFinite(maxTs) ? formatUtcDateIso(maxTs) : null,
    matches,
    warningMessage,
    computedAtUtc,
    computeDurationMs,
    usedWorker,
  };
}

export function runBestMatchedCandlesFromCandles(
  candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>>,
  config: BestMatchConfig,
  onProgress?: (progress: BestMatchProgress) => void,
  usedWorker = false
): BestMatchResult {
  if (config.scope === 'multi_tf') {
    return runMultiTimeframeMatchSearchFromCandles(candlesByTf, config, onProgress, usedWorker);
  }
  return runSingleFileMatchSearchFromCandles(candlesByTf, config, onProgress, usedWorker);
}

export function runBestMatchedCandlesSearch(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>,
  config: BestMatchConfig,
  onProgress?: (progress: BestMatchProgress) => void,
  usedWorker = false
): BestMatchResult {
  const candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>> = {};
  for (const tf of TIMEFRAMES) {
    const ds = datasets[tf.id];
    if (ds && ds.candles.length > 0) {
      candlesByTf[tf.id] = ds.candles;
    }
  }
  return runBestMatchedCandlesFromCandles(candlesByTf, config, onProgress, usedWorker);
}

export function filterAndRankBestMatches(
  matches: BestMatchItem[],
  filters: BestMatchFilterState
): BestMatchItem[] {
  const q = filters.searchQuery.trim().toLowerCase();
  return matches
    .filter((m) => {
      if (m.matchScore < filters.minScoreOverride) return false;
      if (filters.directionFilter === 'bullish' && m.dominantDirection !== 'BULLISH') return false;
      if (filters.directionFilter === 'bearish' && m.dominantDirection !== 'BEARISH') return false;
      if (filters.directionFilter === 'doji' && m.dominantDirection !== 'DOJI') return false;
      if (q) {
        const hay = `${m.timeStr} ${m.patternLabel} ${m.summaryDetail} ${m.snapshots.map((s) => s.timeframe).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      if (b.structuralScore !== a.structuralScore) return b.structuralScore - a.structuralScore;
      return b.timestamp - a.timestamp;
    });
}

// ============================================================================
// Intraday Time-Slot Direction Correlation & Full-Matrix Collector Engine
// ============================================================================

const MS_PER_DAY = 86_400_000;

export function extractUtcDayKey(ts: number): number {
  return Math.floor(ts / MS_PER_DAY);
}

export function extractUtcDayDateStr(dayKey: number): string {
  return formatUtcDateIso(dayKey * MS_PER_DAY);
}

export function hasNonZeroSecondsInCandles(candles: EnrichedCandle[]): boolean {
  for (let i = 0; i < candles.length; i++) {
    const rem = ((candles[i].timestamp % 60_000) + 60_000) % 60_000;
    if (rem !== 0) return true;
  }
  return false;
}

export function extractUtcIntradaySlot(
  ts: number,
  includeSeconds: boolean
): { key: string; sortOrder: number } {
  const msIntoDay = ((ts % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  const secOfDay = Math.floor(msIntoDay / 1000);
  const hh = Math.floor(secOfDay / 3600);
  const mm = Math.floor((secOfDay % 3600) / 60);
  const ss = secOfDay % 60;
  const key = includeSeconds
    ? `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`
    : `${pad2(hh)}:${pad2(mm)}`;
  return { key, sortOrder: secOfDay };
}

export interface IntradaySlotMenuOption {
  key: string;
  sortOrder: number;
  totalCount: number;
  nonDojiCount: number;
}

export function getIntradayTimeSlotOptions(
  candles: EnrichedCandle[]
): IntradaySlotMenuOption[] {
  if (candles.length === 0) return [];
  const includeSec = hasNonZeroSecondsInCandles(candles);
  const map = new Map<string, IntradaySlotMenuOption>();

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const slot = extractUtcIntradaySlot(c.timestamp, includeSec);
    let entry = map.get(slot.key);
    if (!entry) {
      entry = {
        key: slot.key,
        sortOrder: slot.sortOrder,
        totalCount: 0,
        nonDojiCount: 0,
      };
      map.set(slot.key, entry);
    }
    entry.totalCount++;
    if (c.candleType !== 'DOJI') {
      entry.nonDojiCount++;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

function isIntradayDirectionMatch(
  anchorType: CandleType,
  targetType: CandleType,
  filter: IntradayDirectionFilter
): boolean {
  if (anchorType === 'DOJI' || targetType === 'DOJI') return false;
  if (anchorType !== targetType) return false;
  if (filter === 'bullish_only') return anchorType === 'BULLISH';
  if (filter === 'bearish_only') return anchorType === 'BEARISH';
  return true;
}

/**
 * Computes exact chronological UTC calendar-day records (`YYYY-MM-DD`) comparing
 * a single `(anchorTf, anchorSlotKey)` against `(targetTf, targetSlotKey)`.
 */
export function getIntradayPairDayRecords(
  candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>>,
  anchorTf: TimeframeId,
  anchorSlotKey: string,
  targetTf: TimeframeId,
  targetSlotKey: string,
  directionFilter: IntradayDirectionFilter,
  startDateUtc = '',
  endDateUtc = ''
): IntradayDayRecord[] {
  const anchorCandles = candlesByTf[anchorTf] ?? [];
  const targetCandles = candlesByTf[targetTf] ?? [];
  if (anchorCandles.length === 0 || targetCandles.length === 0) return [];

  const filterStartMs = startDateUtc ? parseIsoDateStartUtcMs(startDateUtc) : null;
  const filterEndMs = endDateUtc ? parseIsoDateEndUtcMs(endDateUtc) : null;
  const anchorSec = hasNonZeroSecondsInCandles(anchorCandles);
  const targetSec = hasNonZeroSecondsInCandles(targetCandles);

  const anchorByDay = new Map<number, EnrichedCandle>();
  for (let i = 0; i < anchorCandles.length; i++) {
    const c = anchorCandles[i];
    if (filterStartMs !== null && c.timestamp < filterStartMs) continue;
    if (filterEndMs !== null && c.timestamp > filterEndMs) continue;
    if (c.candleType === 'DOJI') continue;
    const slot = extractUtcIntradaySlot(c.timestamp, anchorSec);
    if (slot.key !== anchorSlotKey) continue;
    anchorByDay.set(extractUtcDayKey(c.timestamp), c);
  }

  const records: IntradayDayRecord[] = [];
  for (let i = 0; i < targetCandles.length; i++) {
    const tc = targetCandles[i];
    if (filterStartMs !== null && tc.timestamp < filterStartMs) continue;
    if (filterEndMs !== null && tc.timestamp > filterEndMs) continue;
    const slot = extractUtcIntradaySlot(tc.timestamp, targetSec);
    if (slot.key !== targetSlotKey) continue;

    const dayKey = extractUtcDayKey(tc.timestamp);
    const ac = anchorByDay.get(dayKey);
    if (!ac) continue;

    const matched = isIntradayDirectionMatch(ac.candleType, tc.candleType, directionFilter);
    records.push({
      dateStr: extractUtcDayDateStr(dayKey),
      anchorCandle: ac,
      targetCandle: tc,
      isMatch: matched,
      matchDirection: matched ? (ac.candleType as 'BULLISH' | 'BEARISH') : null,
    });
  }

  return records;
}

function compareIntradaySlotMatchItems(
  a: IntradaySlotMatchItem,
  b: IntradaySlotMatchItem
): number {
  if (b.matchRatePct !== a.matchRatePct) return b.matchRatePct - a.matchRatePct;
  if (b.matchedDays !== a.matchedDays) return b.matchedDays - a.matchedDays;
  if (b.totalCoOccurringDays !== a.totalCoOccurringDays) {
    return b.totalCoOccurringDays - a.totalCoOccurringDays;
  }
  const tfCmp =
    TIMEFRAME_MAP[a.targetTimeframe].rankOrder - TIMEFRAME_MAP[b.targetTimeframe].rankOrder;
  if (tfCmp !== 0) return tfCmp;
  return a.targetSlotSortOrder - b.targetSlotSortOrder;
}

function popcnt32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Mode 1A: Single-Anchor Intraday Time-Slot Direction Correlation (e.g. Anchor = `00:01`).
 */
export function runSingleAnchorIntradaySlotMatchFromCandles(
  candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>>,
  config: IntradaySlotMatchConfig,
  onProgress?: (progress: BestMatchProgress) => void,
  usedWorker = false
): IntradaySlotMatchResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const computedAtUtc = formatUtcTimestamp(Date.now());

  const anchorCandles = candlesByTf[config.anchorTimeframe] ?? [];
  const targetTfs = Array.from(new Set(config.targetTimeframes))
    .filter((tf) => Boolean(candlesByTf[tf] && candlesByTf[tf]!.length > 0))
    .sort((a, b) => TIMEFRAME_MAP[a].rankOrder - TIMEFRAME_MAP[b].rankOrder);

  const makeEmpty = (warningMessage: string): IntradaySlotMatchResult => ({
    config,
    scopeMode: 'single_anchor',
    anchorTimeframe: config.anchorTimeframe,
    anchorSlotKey: config.anchorSlotKey,
    targetTimeframes: targetTfs,
    totalValidDaysEvaluated: 0,
    totalAnchorSlotsEvaluated: anchorCandles.length > 0 ? 1 : 0,
    totalPairwiseEvaluations: 0,
    effectiveStartUtc: null,
    effectiveEndUtc: null,
    matches: [],
    matrixSummaries: [],
    warningMessage,
    computedAtUtc,
    computeDurationMs: Math.max(
      0,
      Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
    ),
    usedWorker,
  });

  if (anchorCandles.length === 0) {
    return makeEmpty(`Anchor timeframe ${config.anchorTimeframe} has no uploaded candles.`);
  }
  if (targetTfs.length === 0) {
    return makeEmpty('Select at least one uploaded target timeframe.');
  }

  const filterStartMs = config.startDateUtc ? parseIsoDateStartUtcMs(config.startDateUtc) : null;
  const filterEndMs = config.endDateUtc ? parseIsoDateEndUtcMs(config.endDateUtc) : null;
  if (filterStartMs !== null && filterEndMs !== null && filterStartMs > filterEndMs) {
    return makeEmpty('Start UTC date cannot be after End UTC date.');
  }

  onProgress?.({ percent: 10, scanned: 0, total: anchorCandles.length, stage: 'indexing' });

  const anchorHasSec = hasNonZeroSecondsInCandles(anchorCandles);
  const anchorByDay = new Map<number, EnrichedCandle>();
  let minDayKey = Infinity;
  let maxDayKey = -Infinity;

  for (let i = 0; i < anchorCandles.length; i++) {
    const c = anchorCandles[i];
    if (filterStartMs !== null && c.timestamp < filterStartMs) continue;
    if (filterEndMs !== null && c.timestamp > filterEndMs) continue;
    if (c.candleType === 'DOJI') continue;

    const slot = extractUtcIntradaySlot(c.timestamp, anchorHasSec);
    if (slot.key !== config.anchorSlotKey) continue;

    const dayKey = extractUtcDayKey(c.timestamp);
    anchorByDay.set(dayKey, c);
    if (dayKey < minDayKey) minDayKey = dayKey;
    if (dayKey > maxDayKey) maxDayKey = dayKey;
  }

  if (anchorByDay.size === 0) {
    return makeEmpty(
      `No valid non-Doji occurrences of anchor slot ${config.anchorSlotKey} UTC were found in ${config.anchorTimeframe} for the selected UTC range.`
    );
  }

  interface Accumulator {
    targetTimeframe: TimeframeId;
    targetSlotKey: string;
    targetSlotSortOrder: number;
    totalCoOccurringDays: number;
    matchedDays: number;
    bullishMatches: number;
    bearishMatches: number;
  }

  const totalTargetRows = targetTfs.reduce((sum, tf) => sum + candlesByTf[tf]!.length, 0);
  let scannedRows = 0;
  const accMap = new Map<string, Accumulator>();

  for (let tIdx = 0; tIdx < targetTfs.length; tIdx++) {
    const targetTf = targetTfs[tIdx];
    const tCandles = candlesByTf[targetTf]!;
    const targetHasSec = hasNonZeroSecondsInCandles(tCandles);
    const step = Math.max(2000, Math.floor(tCandles.length / 15));

    for (let i = 0; i < tCandles.length; i++) {
      if (i % step === 0) {
        const pct = 15 + Math.round(((scannedRows + i) / Math.max(1, totalTargetRows)) * 65);
        onProgress?.({
          percent: pct,
          scanned: scannedRows + i,
          total: totalTargetRows,
          stage: 'scoring',
        });
      }

      const tc = tCandles[i];
      if (filterStartMs !== null && tc.timestamp < filterStartMs) continue;
      if (filterEndMs !== null && tc.timestamp > filterEndMs) continue;

      const dayKey = extractUtcDayKey(tc.timestamp);
      const anchorCandle = anchorByDay.get(dayKey);
      if (!anchorCandle) continue;

      const slot = extractUtcIntradaySlot(tc.timestamp, targetHasSec);
      if (
        config.excludeSelfSlot &&
        targetTf === config.anchorTimeframe &&
        slot.key === config.anchorSlotKey
      ) {
        continue;
      }

      const accKey = `${targetTf}|${slot.key}`;
      let acc = accMap.get(accKey);
      if (!acc) {
        acc = {
          targetTimeframe: targetTf,
          targetSlotKey: slot.key,
          targetSlotSortOrder: slot.sortOrder,
          totalCoOccurringDays: 0,
          matchedDays: 0,
          bullishMatches: 0,
          bearishMatches: 0,
        };
        accMap.set(accKey, acc);
      }

      acc.totalCoOccurringDays++;
      if (isIntradayDirectionMatch(anchorCandle.candleType, tc.candleType, config.directionFilter)) {
        acc.matchedDays++;
        if (anchorCandle.candleType === 'BULLISH') {
          acc.bullishMatches++;
        } else {
          acc.bearishMatches++;
        }
      }
    }

    scannedRows += tCandles.length;
  }

  onProgress?.({ percent: 85, scanned: totalTargetRows, total: totalTargetRows, stage: 'ranking' });

  const minDays = Math.max(1, Math.floor(config.minCoOccurringDays || 1));
  const minRate = Math.max(0, Math.min(100, config.minMatchRatePct || 0));

  const qualifying: IntradaySlotMatchItem[] = [];
  let totalEvaluatedSlots = 0;
  let filteredOutByMinDays = 0;

  for (const acc of accMap.values()) {
    totalEvaluatedSlots++;
    if (acc.totalCoOccurringDays < minDays) {
      filteredOutByMinDays++;
      continue;
    }
    const matchRatePct =
      acc.totalCoOccurringDays > 0
        ? round2((acc.matchedDays / acc.totalCoOccurringDays) * 100)
        : 0;
    if (matchRatePct < minRate) continue;

    qualifying.push({
      id: `idslot_${config.anchorTimeframe}_${config.anchorSlotKey}_${acc.targetTimeframe}_${acc.targetSlotKey}`,
      rank: 0,
      anchorTimeframe: config.anchorTimeframe,
      anchorSlotKey: config.anchorSlotKey,
      targetTimeframe: acc.targetTimeframe,
      targetSlotKey: acc.targetSlotKey,
      targetSlotSortOrder: acc.targetSlotSortOrder,
      totalCoOccurringDays: acc.totalCoOccurringDays,
      matchedDays: acc.matchedDays,
      bullishMatches: acc.bullishMatches,
      bearishMatches: acc.bearishMatches,
      matchRatePct,
      dayRecords: [],
    });
  }

  qualifying.sort(compareIntradaySlotMatchItems);
  const topMatches = qualifying.slice(0, config.maxResults);

  // Build exact chronological dayRecords for returned ranked slots
  for (let i = 0; i < topMatches.length; i++) {
    topMatches[i].rank = i + 1;
    topMatches[i].dayRecords = getIntradayPairDayRecords(
      candlesByTf,
      config.anchorTimeframe,
      config.anchorSlotKey,
      topMatches[i].targetTimeframe,
      topMatches[i].targetSlotKey,
      config.directionFilter,
      config.startDateUtc,
      config.endDateUtc
    );
  }

  onProgress?.({ percent: 100, scanned: totalTargetRows, total: totalTargetRows, stage: 'ranking' });

  let warningMessage: string | null = null;
  if (totalEvaluatedSlots === 0) {
    warningMessage = `No co-occurring same-day candles were found across ${targetTfs.join(', ')} on days containing anchor ${config.anchorSlotKey} UTC.`;
  } else if (topMatches.length === 0) {
    if (filteredOutByMinDays === totalEvaluatedSlots) {
      warningMessage = `Found ${totalEvaluatedSlots} target slots, but none reached the minimum ${minDays} co-occurring days threshold (max available anchor days: ${anchorByDay.size}). Lower "Min Co-Occurring Days" in Step 3.`;
    } else {
      warningMessage = `Evaluated ${totalEvaluatedSlots.toLocaleString()} target slots, but none met ≥ ${minRate}% Match Rate and ≥ ${minDays} co-occurring days. Lower thresholds in Step 3.`;
    }
  }

  const computeDurationMs = Math.max(
    0,
    Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
  );

  return {
    config,
    scopeMode: 'single_anchor',
    anchorTimeframe: config.anchorTimeframe,
    anchorSlotKey: config.anchorSlotKey,
    targetTimeframes: targetTfs,
    totalValidDaysEvaluated: anchorByDay.size,
    totalAnchorSlotsEvaluated: 1,
    totalPairwiseEvaluations: totalEvaluatedSlots,
    effectiveStartUtc: Number.isFinite(minDayKey) ? extractUtcDayDateStr(minDayKey) : null,
    effectiveEndUtc: Number.isFinite(maxDayKey) ? extractUtcDayDateStr(maxDayKey) : null,
    matches: topMatches,
    matrixSummaries: [],
    warningMessage,
    computedAtUtc,
    computeDurationMs,
    usedWorker,
  };
}

/**
 * Mode 1B: Full-Matrix ("Collect All Intraday Slots") Engine.
 * Evaluates EVERY unique intraday anchor time slot against EVERY target `(timeframe, slot)`
 * using 32-bit packed day bitsets so even 1,440 × 1,440 multi-year 1MIN matrices finish cleanly.
 */
export function runFullMatrixIntradaySlotMatchFromCandles(
  candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>>,
  config: IntradaySlotMatchConfig,
  onProgress?: (progress: BestMatchProgress) => void,
  usedWorker = false
): IntradaySlotMatchResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const computedAtUtc = formatUtcTimestamp(Date.now());

  const anchorCandles = candlesByTf[config.anchorTimeframe] ?? [];
  const targetTfs = Array.from(new Set(config.targetTimeframes))
    .filter((tf) => Boolean(candlesByTf[tf] && candlesByTf[tf]!.length > 0))
    .sort((a, b) => TIMEFRAME_MAP[a].rankOrder - TIMEFRAME_MAP[b].rankOrder);

  const makeEmpty = (warningMessage: string): IntradaySlotMatchResult => ({
    config,
    scopeMode: 'full_matrix',
    anchorTimeframe: config.anchorTimeframe,
    anchorSlotKey: null,
    targetTimeframes: targetTfs,
    totalValidDaysEvaluated: 0,
    totalAnchorSlotsEvaluated: 0,
    totalPairwiseEvaluations: 0,
    effectiveStartUtc: null,
    effectiveEndUtc: null,
    matches: [],
    matrixSummaries: [],
    warningMessage,
    computedAtUtc,
    computeDurationMs: Math.max(
      0,
      Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
    ),
    usedWorker,
  });

  if (anchorCandles.length === 0) {
    return makeEmpty(`Anchor timeframe ${config.anchorTimeframe} has no uploaded candles.`);
  }
  if (targetTfs.length === 0) {
    return makeEmpty('Select at least one uploaded target timeframe.');
  }

  const filterStartMs = config.startDateUtc ? parseIsoDateStartUtcMs(config.startDateUtc) : null;
  const filterEndMs = config.endDateUtc ? parseIsoDateEndUtcMs(config.endDateUtc) : null;
  if (filterStartMs !== null && filterEndMs !== null && filterStartMs > filterEndMs) {
    return makeEmpty('Start UTC date cannot be after End UTC date.');
  }

  onProgress?.({ percent: 5, scanned: 0, total: anchorCandles.length, stage: 'indexing' });

  const anchorHasSec = hasNonZeroSecondsInCandles(anchorCandles);

  // Step 1: Discover all valid UTC dayKeys and all unique anchor slots
  const daySet = new Set<number>();
  const anchorSlotMetaMap = new Map<
    string,
    {
      key: string;
      sortOrder: number;
      validDays: number;
      bullDays: number;
      bearDays: number;
    }
  >();

  let minDayKey = Infinity;
  let maxDayKey = -Infinity;

  for (let i = 0; i < anchorCandles.length; i++) {
    const c = anchorCandles[i];
    if (filterStartMs !== null && c.timestamp < filterStartMs) continue;
    if (filterEndMs !== null && c.timestamp > filterEndMs) continue;

    const slot = extractUtcIntradaySlot(c.timestamp, anchorHasSec);
    let sMeta = anchorSlotMetaMap.get(slot.key);
    if (!sMeta) {
      sMeta = {
        key: slot.key,
        sortOrder: slot.sortOrder,
        validDays: 0,
        bullDays: 0,
        bearDays: 0,
      };
      anchorSlotMetaMap.set(slot.key, sMeta);
    }

    if (c.candleType === 'DOJI') continue;

    const dayKey = extractUtcDayKey(c.timestamp);
    daySet.add(dayKey);
    if (dayKey < minDayKey) minDayKey = dayKey;
    if (dayKey > maxDayKey) maxDayKey = dayKey;

    sMeta.validDays++;
    if (c.candleType === 'BULLISH') sMeta.bullDays++;
    else sMeta.bearDays++;
  }

  if (daySet.size === 0 || anchorSlotMetaMap.size === 0) {
    return makeEmpty(
      `No valid non-Doji candles found in ${config.anchorTimeframe} for the selected UTC date range.`
    );
  }

  const sortedDays = Array.from(daySet).sort((a, b) => a - b);
  const dayToIdx = new Map<number, number>();
  for (let d = 0; d < sortedDays.length; d++) {
    dayToIdx.set(sortedDays[d], d);
  }

  const anchorSlots = Array.from(anchorSlotMetaMap.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder
  );
  const anchorSlotToIdx = new Map<string, number>();
  for (let a = 0; a < anchorSlots.length; a++) {
    anchorSlotToIdx.set(anchorSlots[a].key, a);
  }

  // Step 2: Discover all unique `(targetTf, targetSlotKey)` columns
  interface TargetSlotMeta {
    tf: TimeframeId;
    key: string;
    sortOrder: number;
  }
  const targetMetaMap = new Map<string, TargetSlotMeta>();
  const targetHasSecByTf: Partial<Record<TimeframeId, boolean>> = {};

  for (const tf of targetTfs) {
    const arr = candlesByTf[tf]!;
    const hasSec = hasNonZeroSecondsInCandles(arr);
    targetHasSecByTf[tf] = hasSec;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (filterStartMs !== null && c.timestamp < filterStartMs) continue;
      if (filterEndMs !== null && c.timestamp > filterEndMs) continue;
      const dayKey = extractUtcDayKey(c.timestamp);
      if (!dayToIdx.has(dayKey)) continue;

      const slot = extractUtcIntradaySlot(c.timestamp, hasSec);
      const id = `${tf}|${slot.key}`;
      if (!targetMetaMap.has(id)) {
        targetMetaMap.set(id, { tf, key: slot.key, sortOrder: slot.sortOrder });
      }
    }
  }

  const targetSlots = Array.from(targetMetaMap.values()).sort((a, b) => {
    const tfCmp = TIMEFRAME_MAP[a.tf].rankOrder - TIMEFRAME_MAP[b.tf].rankOrder;
    return tfCmp !== 0 ? tfCmp : a.sortOrder - b.sortOrder;
  });
  const targetToIdx = new Map<string, number>();
  for (let t = 0; t < targetSlots.length; t++) {
    targetToIdx.set(`${targetSlots[t].tf}|${targetSlots[t].key}`, t);
  }

  const numDays = sortedDays.length;
  const numWords = Math.ceil(numDays / 32);
  const numAnchors = anchorSlots.length;
  const numTargets = targetSlots.length;

  onProgress?.({ percent: 15, scanned: 0, total: numAnchors, stage: 'indexing' });

  // Step 3: Populate compact 32-bit packed day bitsets
  const aBullBits = new Uint32Array(numAnchors * numWords);
  const aBearBits = new Uint32Array(numAnchors * numWords);
  const tPresentBits = new Uint32Array(numTargets * numWords);
  const tBullBits = new Uint32Array(numTargets * numWords);
  const tBearBits = new Uint32Array(numTargets * numWords);

  for (let i = 0; i < anchorCandles.length; i++) {
    const c = anchorCandles[i];
    if (c.candleType === 'DOJI') continue;
    if (filterStartMs !== null && c.timestamp < filterStartMs) continue;
    if (filterEndMs !== null && c.timestamp > filterEndMs) continue;

    const dIdx = dayToIdx.get(extractUtcDayKey(c.timestamp));
    if (dIdx === undefined) continue;

    const slot = extractUtcIntradaySlot(c.timestamp, anchorHasSec);
    const aIdx = anchorSlotToIdx.get(slot.key);
    if (aIdx === undefined) continue;

    const word = dIdx >>> 5;
    const bit = 1 << (dIdx & 31);
    const base = aIdx * numWords + word;
    if (c.candleType === 'BULLISH') {
      aBullBits[base] |= bit;
    } else {
      aBearBits[base] |= bit;
    }
  }

  for (const tf of targetTfs) {
    const arr = candlesByTf[tf]!;
    const hasSec = Boolean(targetHasSecByTf[tf]);
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (filterStartMs !== null && c.timestamp < filterStartMs) continue;
      if (filterEndMs !== null && c.timestamp > filterEndMs) continue;

      const dIdx = dayToIdx.get(extractUtcDayKey(c.timestamp));
      if (dIdx === undefined) continue;

      const slot = extractUtcIntradaySlot(c.timestamp, hasSec);
      const tIdx = targetToIdx.get(`${tf}|${slot.key}`);
      if (tIdx === undefined) continue;

      const word = dIdx >>> 5;
      const bit = 1 << (dIdx & 31);
      const base = tIdx * numWords + word;
      tPresentBits[base] |= bit;
      if (c.candleType === 'BULLISH') {
        tBullBits[base] |= bit;
      } else if (c.candleType === 'BEARISH') {
        tBearBits[base] |= bit;
      }
    }
  }

  // Step 4: Fast Bitset Pairwise Matrix Evaluation
  const minDays = Math.max(1, Math.floor(config.minCoOccurringDays || 1));
  const minRate = Math.max(0, Math.min(100, config.minMatchRatePct || 0));
  const topPerAnchorLimit = 10;
  const matrixSummaries: IntradayFullMatrixAnchorSummary[] = [];
  let totalPairwiseEvaluations = 0;

  const progressStep = Math.max(1, Math.floor(numAnchors / 30));

  for (let aIdx = 0; aIdx < numAnchors; aIdx++) {
    if (aIdx % progressStep === 0) {
      const pct = 20 + Math.round((aIdx / Math.max(1, numAnchors)) * 72);
      onProgress?.({ percent: pct, scanned: aIdx, total: numAnchors, stage: 'scoring' });
    }

    const aMeta = anchorSlots[aIdx];
    const aBase = aIdx * numWords;

    const topTargets: IntradaySlotMatchItem[] = [];
    let qualifyingRateSum = 0;
    let qualifyingCount = 0;

    if (aMeta.validDays > 0) {
      for (let tIdx = 0; tIdx < numTargets; tIdx++) {
        const tMeta = targetSlots[tIdx];
        if (
          config.excludeSelfSlot &&
          tMeta.tf === config.anchorTimeframe &&
          tMeta.key === aMeta.key
        ) {
          continue;
        }

        const tBase = tIdx * numWords;
        let coOccurring = 0;
        let bullMatches = 0;
        let bearMatches = 0;

        for (let w = 0; w < numWords; w++) {
          const ab = aBullBits[aBase + w];
          const as = aBearBits[aBase + w];
          const aValid = ab | as;
          if (aValid === 0) continue;

          const tp = tPresentBits[tBase + w];
          if (tp === 0) continue;

          coOccurring += popcnt32(aValid & tp);
          bullMatches += popcnt32(ab & tBullBits[tBase + w]);
          bearMatches += popcnt32(as & tBearBits[tBase + w]);
        }

        if (coOccurring === 0) continue;
        totalPairwiseEvaluations++;
        if (coOccurring < minDays) continue;

        const matchedDays =
          config.directionFilter === 'bullish_only'
            ? bullMatches
            : config.directionFilter === 'bearish_only'
              ? bearMatches
              : bullMatches + bearMatches;

        const matchRatePct = round2((matchedDays / coOccurring) * 100);
        if (matchRatePct < minRate) continue;

        qualifyingRateSum += matchRatePct;
        qualifyingCount++;

        const candidateItem: IntradaySlotMatchItem = {
          id: `mtx_${config.anchorTimeframe}_${aMeta.key}_${tMeta.tf}_${tMeta.key}`,
          rank: 0,
          anchorTimeframe: config.anchorTimeframe,
          anchorSlotKey: aMeta.key,
          targetTimeframe: tMeta.tf,
          targetSlotKey: tMeta.key,
          targetSlotSortOrder: tMeta.sortOrder,
          totalCoOccurringDays: coOccurring,
          matchedDays,
          bullishMatches: config.directionFilter === 'bearish_only' ? 0 : bullMatches,
          bearishMatches: config.directionFilter === 'bullish_only' ? 0 : bearMatches,
          matchRatePct,
          dayRecords: [],
        };

        // Maintain sorted bounded Top 10 targets for this anchor slot
        if (topTargets.length < topPerAnchorLimit) {
          topTargets.push(candidateItem);
          topTargets.sort(compareIntradaySlotMatchItems);
        } else {
          const weakest = topTargets[topTargets.length - 1];
          if (compareIntradaySlotMatchItems(candidateItem, weakest) < 0) {
            topTargets[topTargets.length - 1] = candidateItem;
            topTargets.sort(compareIntradaySlotMatchItems);
          }
        }
      }
    }

    for (let r = 0; r < topTargets.length; r++) {
      topTargets[r].rank = r + 1;
    }

    const top5Slice = topTargets.slice(0, 5);
    const top5AvgMatchRatePct =
      top5Slice.length > 0
        ? round2(top5Slice.reduce((s, item) => s + item.matchRatePct, 0) / top5Slice.length)
        : 0;
    const overallAvgMatchRatePct =
      qualifyingCount > 0 ? round2(qualifyingRateSum / qualifyingCount) : 0;

    matrixSummaries.push({
      id: `anchor_${config.anchorTimeframe}_${aMeta.key}`,
      anchorTimeframe: config.anchorTimeframe,
      anchorSlotKey: aMeta.key,
      anchorSlotSortOrder: aMeta.sortOrder,
      totalValidAnchorDays: aMeta.validDays,
      bullishAnchorDays: aMeta.bullDays,
      bearishAnchorDays: aMeta.bearDays,
      bestTarget: topTargets[0] ?? null,
      topTargets,
      top5AvgMatchRatePct,
      overallAvgMatchRatePct,
    });
  }

  onProgress?.({ percent: 100, scanned: numAnchors, total: numAnchors, stage: 'ranking' });

  const hasAnyBest = matrixSummaries.some((m) => m.bestTarget !== null);
  let warningMessage: string | null = null;
  if (!hasAnyBest) {
    warningMessage = `Evaluated ${numAnchors} anchor slots across ${numDays} UTC days, but no target pairs met ≥ ${minRate}% Match Rate and ≥ ${minDays} co-occurring days. Lower thresholds in Step 3.`;
  }

  const computeDurationMs = Math.max(
    0,
    Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100) / 100
  );

  return {
    config,
    scopeMode: 'full_matrix',
    anchorTimeframe: config.anchorTimeframe,
    anchorSlotKey: null,
    targetTimeframes: targetTfs,
    totalValidDaysEvaluated: numDays,
    totalAnchorSlotsEvaluated: numAnchors,
    totalPairwiseEvaluations,
    effectiveStartUtc: Number.isFinite(minDayKey) ? extractUtcDayDateStr(minDayKey) : null,
    effectiveEndUtc: Number.isFinite(maxDayKey) ? extractUtcDayDateStr(maxDayKey) : null,
    matches: [],
    matrixSummaries,
    warningMessage,
    computedAtUtc,
    computeDurationMs,
    usedWorker,
  };
}

export function runIntradaySlotMatchFromCandles(
  candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>>,
  config: IntradaySlotMatchConfig,
  onProgress?: (progress: BestMatchProgress) => void,
  usedWorker = false
): IntradaySlotMatchResult {
  if (config.scopeMode === 'full_matrix') {
    return runFullMatrixIntradaySlotMatchFromCandles(candlesByTf, config, onProgress, usedWorker);
  }
  return runSingleAnchorIntradaySlotMatchFromCandles(candlesByTf, config, onProgress, usedWorker);
}

export function runIntradaySlotMatchSearch(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>,
  config: IntradaySlotMatchConfig,
  onProgress?: (progress: BestMatchProgress) => void,
  usedWorker = false
): IntradaySlotMatchResult {
  const candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>> = {};
  for (const tf of TIMEFRAMES) {
    const ds = datasets[tf.id];
    if (ds && ds.candles.length > 0) {
      candlesByTf[tf.id] = ds.candles;
    }
  }
  return runIntradaySlotMatchFromCandles(candlesByTf, config, onProgress, usedWorker);
}

export function filterAndRankIntradayMatches(
  matches: IntradaySlotMatchItem[],
  filters: IntradaySlotFilterState
): IntradaySlotMatchItem[] {
  const q = filters.searchQuery.trim().toLowerCase();
  return matches
    .filter((m) => {
      if (m.matchRatePct < filters.minRateOverride) return false;
      if (
        filters.targetTimeframeFilter !== 'ALL' &&
        m.targetTimeframe !== filters.targetTimeframeFilter
      ) {
        return false;
      }
      if (
        filters.directionBiasFilter === 'bullish_dominant' &&
        m.bullishMatches <= m.bearishMatches
      ) {
        return false;
      }
      if (
        filters.directionBiasFilter === 'bearish_dominant' &&
        m.bearishMatches <= m.bullishMatches
      ) {
        return false;
      }
      if (q) {
        const hay = `${m.targetSlotKey} ${m.targetTimeframe} ${m.anchorSlotKey} ${m.anchorTimeframe}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .slice()
    .sort(compareIntradaySlotMatchItems);
}

export function filterIntradayMatrixSummaries(
  summaries: IntradayFullMatrixAnchorSummary[],
  filters: IntradaySlotFilterState
): IntradayFullMatrixAnchorSummary[] {
  const q = filters.searchQuery.trim().toLowerCase();
  return summaries.filter((row) => {
    const best = row.bestTarget;
    if (filters.minRateOverride > 0 && (!best || best.matchRatePct < filters.minRateOverride)) {
      return false;
    }
    if (
      filters.targetTimeframeFilter !== 'ALL' &&
      (!best || best.targetTimeframe !== filters.targetTimeframeFilter)
    ) {
      return false;
    }
    if (filters.directionBiasFilter === 'bullish_dominant') {
      if (!best || best.bullishMatches <= best.bearishMatches) return false;
    }
    if (filters.directionBiasFilter === 'bearish_dominant') {
      if (!best || best.bearishMatches <= best.bullishMatches) return false;
    }
    if (q) {
      const hay = `${row.anchorSlotKey} ${row.anchorTimeframe} ${best ? `${best.targetTimeframe} ${best.targetSlotKey}` : ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}


