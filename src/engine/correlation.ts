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
  EnrichedCandle,
  PairRecord,
  PrincipalCandidateResult,
  ResultsFilterState,
  SlotOption,
  TimeframeDataset,
  TimeframeId,
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
