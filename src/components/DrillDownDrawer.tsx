import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getIntradayPairDayRecords } from '../engine/correlation';
import { formatDecimal } from '../engine/csvParser';
import {
  BestMatchItem,
  BestMatchSearchScope,
  EnrichedCandle,
  IntradayFullMatrixAnchorSummary,
  IntradaySlotMatchConfig,
  IntradaySlotMatchItem,
  MatchedCandleSnapshot,
  PrincipalCandidateResult,
  TimeframeDataset,
  TimeframeId,
  TIMEFRAMES,
} from '../engine/types';
import { CandlestickComparisonPanel, SingleCandleGlyph } from './CandleGlyph';

interface DrillDownDrawerProps {
  candidate?: PrincipalCandidateResult | null;
  targetDescription?: string;
  bestMatch?: BestMatchItem | null;
  referenceSnapshots?: MatchedCandleSnapshot[] | null;
  bestMatchScope?: BestMatchSearchScope;
  // Intraday Time-Slot inspection props
  intradayMatch?: IntradaySlotMatchItem | null;
  intradayMatrixRow?: IntradayFullMatrixAnchorSummary | null;
  intradayConfig?: IntradaySlotMatchConfig;
  datasets?: Partial<Record<TimeframeId, TimeframeDataset>>;
  onClose: () => void;
}

type PairFilter = 'all' | 'match' | 'mismatch' | 'doji';
type IntradayDayFilter = 'all' | 'match' | 'mismatch';

const PAGE_SIZE = 100;

export function DrillDownDrawer({
  candidate = null,
  targetDescription = '',
  bestMatch = null,
  referenceSnapshots = null,
  bestMatchScope,
  intradayMatch = null,
  intradayMatrixRow = null,
  intradayConfig,
  datasets,
  onClose,
}: DrillDownDrawerProps) {
  const [pairFilter, setPairFilter] = useState<PairFilter>('all');
  const [intradayDayFilter, setIntradayDayFilter] = useState<IntradayDayFilter>('all');
  const [selectedMatrixTargetId, setSelectedMatrixTargetId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPairFilter('all');
    setIntradayDayFilter('all');
    setSelectedMatrixTargetId(intradayMatrixRow?.bestTarget?.id ?? null);
    setPage(1);
  }, [candidate?.slotKey, bestMatch?.id, intradayMatch?.id, intradayMatrixRow?.id, intradayMatrixRow?.bestTarget?.id]);

  const isOpen = Boolean(candidate || bestMatch || intradayMatch || intradayMatrixRow);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const counts = useMemo(() => {
    if (!candidate) return { all: 0, match: 0, mismatch: 0, doji: 0 };
    let match = 0;
    let mismatch = 0;
    let doji = 0;
    for (const p of candidate.pairs) {
      if (p.isDojiExcluded) doji++;
      else if (p.isMatch) match++;
      else mismatch++;
    }
    return { all: candidate.pairs.length, match, mismatch, doji };
  }, [candidate]);

  const filteredPairs = useMemo(() => {
    if (!candidate) return [];
    if (pairFilter === 'all') return candidate.pairs;
    if (pairFilter === 'doji') return candidate.pairs.filter((p) => p.isDojiExcluded);
    if (pairFilter === 'match') return candidate.pairs.filter((p) => !p.isDojiExcluded && p.isMatch);
    return candidate.pairs.filter((p) => !p.isDojiExcluded && !p.isMatch);
  }, [candidate, pairFilter]);

  const activeMatrixTarget = useMemo(() => {
    if (!intradayMatrixRow) return null;
    if (selectedMatrixTargetId) {
      const found = intradayMatrixRow.topTargets.find((t) => t.id === selectedMatrixTargetId);
      if (found) return found;
    }
    return intradayMatrixRow.bestTarget ?? intradayMatrixRow.topTargets[0] ?? null;
  }, [intradayMatrixRow, selectedMatrixTargetId]);

  const activeIntradayPair = intradayMatch ?? activeMatrixTarget;

  const intradayDayRecords = useMemo(() => {
    if (!activeIntradayPair) return [];
    if (activeIntradayPair.dayRecords && activeIntradayPair.dayRecords.length > 0) {
      return activeIntradayPair.dayRecords;
    }
    if (!datasets) return [];
    const candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>> = {};
    for (const tf of TIMEFRAMES) {
      const ds = datasets[tf.id];
      if (ds && ds.candles.length > 0) candlesByTf[tf.id] = ds.candles;
    }
    return getIntradayPairDayRecords(
      candlesByTf,
      activeIntradayPair.anchorTimeframe,
      activeIntradayPair.anchorSlotKey,
      activeIntradayPair.targetTimeframe,
      activeIntradayPair.targetSlotKey,
      intradayConfig?.directionFilter ?? 'any_non_doji',
      intradayConfig?.startDateUtc ?? '',
      intradayConfig?.endDateUtc ?? ''
    );
  }, [activeIntradayPair, datasets, intradayConfig]);

  const intradayCounts = useMemo(() => {
    let match = 0;
    let mismatch = 0;
    for (const r of intradayDayRecords) {
      if (r.isMatch) match++;
      else mismatch++;
    }
    return { all: intradayDayRecords.length, match, mismatch };
  }, [intradayDayRecords]);

  const filteredIntradayDays = useMemo(() => {
    if (intradayDayFilter === 'all') return intradayDayRecords;
    if (intradayDayFilter === 'match') return intradayDayRecords.filter((r) => r.isMatch);
    return intradayDayRecords.filter((r) => !r.isMatch);
  }, [intradayDayRecords, intradayDayFilter]);

  if (!isOpen) return null;

  // =========================================================================
  // INTRADAY TIME-SLOT INSPECTION VIEW (SINGLE-ANCHOR OR FULL-MATRIX TOP-10)
  // =========================================================================
  if (intradayMatch || intradayMatrixRow) {
    const isMatrix = Boolean(intradayMatrixRow);
    const totalPages = Math.max(1, Math.ceil(filteredIntradayDays.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pageDays = filteredIntradayDays.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    return (
      <div
        className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drilldown-intraday-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="flex h-full w-full max-w-5xl flex-col border-l border-[#1E293B] bg-[#0B0F17] shadow-2xl">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-[#1E293B] bg-[#111824] px-6 py-5">
            <div className="space-y-1">
              <p className="text-xs font-medium text-amber-400">
                {isMatrix
                  ? `Full-Matrix Anchor Inspection · ${intradayMatrixRow!.anchorTimeframe} (${intradayMatrixRow!.anchorSlotKey} UTC)`
                  : `Daily Recurrence Breakdown · Rank #${intradayMatch!.rank}`}
              </p>
              <h2
                id="drilldown-intraday-title"
                className="font-mono text-xl font-bold text-slate-50"
              >
                {activeIntradayPair ? (
                  <>
                    {activeIntradayPair.anchorTimeframe} {activeIntradayPair.anchorSlotKey} UTC
                    <span className="mx-2 text-slate-500">→</span>
                    <span className="text-amber-300">
                      {activeIntradayPair.targetTimeframe} {activeIntradayPair.targetSlotKey} UTC
                    </span>
                  </>
                ) : (
                  `${intradayMatrixRow!.anchorTimeframe} ${intradayMatrixRow!.anchorSlotKey} UTC`
                )}
              </h2>
              <p className="font-mono text-xs tabular-nums text-slate-400">
                {isMatrix
                  ? `${intradayMatrixRow!.totalValidAnchorDays.toLocaleString()} valid anchor days (${intradayMatrixRow!.bullishAnchorDays} Bull · ${intradayMatrixRow!.bearishAnchorDays} Bear)`
                  : `${activeIntradayPair!.matchedDays} / ${activeIntradayPair!.totalCoOccurringDays} same-day directional matches`}
              </p>
            </div>

            <button
              type="button"
              aria-label="Close intraday slot inspection drawer"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#1E293B] bg-[#0B0F17] text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Active Pair KPI Strip */}
          {activeIntradayPair && (
            <div className="grid grid-cols-2 divide-x divide-y divide-[#1E293B] border-b border-[#1E293B] bg-[#0D131E] sm:grid-cols-5 sm:divide-y-0">
              <div className="px-4 py-3">
                <p className="text-[11px] text-slate-400">Match Rate</p>
                <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-400">
                  {activeIntradayPair.matchRatePct.toFixed(2)}%
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[11px] text-slate-400">Matched / Total</p>
                <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-100">
                  {activeIntradayPair.matchedDays} / {activeIntradayPair.totalCoOccurringDays}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[11px] text-slate-400">Bullish Matches</p>
                <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-400">
                  {activeIntradayPair.bullishMatches.toLocaleString()}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[11px] text-slate-400">Bearish Matches</p>
                <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-red-400">
                  {activeIntradayPair.bearishMatches.toLocaleString()}
                </p>
              </div>
              <div className="col-span-2 px-4 py-3 sm:col-span-1">
                <p className="text-[11px] text-slate-400">Non-Matching Days</p>
                <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-300">
                  {(
                    activeIntradayPair.totalCoOccurringDays - activeIntradayPair.matchedDays
                  ).toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {/* Full-Matrix Top 10 Correlated Slots Selector */}
          {isMatrix && intradayMatrixRow && (
            <div className="border-b border-[#1E293B] bg-[#0D131E] px-6 py-4">
              <div className="mb-2.5 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-200">
                  Top {intradayMatrixRow.topTargets.length} Correlated Slots for{' '}
                  {intradayMatrixRow.anchorTimeframe} {intradayMatrixRow.anchorSlotKey} UTC
                </h3>
                <span className="font-mono text-[11px] text-slate-400">
                  Click any correlated target to inspect its daily UTC calendar history below
                </span>
              </div>

              {intradayMatrixRow.topTargets.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No correlated target slots met the active minimum days and match rate thresholds.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {intradayMatrixRow.topTargets.map((item, idx) => {
                    const isSelected = activeIntradayPair?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelectedMatrixTargetId(item.id);
                          setPage(1);
                        }}
                        className={`rounded border px-3 py-2 text-left transition-colors ${
                          isSelected
                            ? 'border-amber-500 bg-amber-500/15'
                            : 'border-[#1E293B] bg-[#111824] hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 font-mono text-[11px]">
                          <span className="text-slate-400">#{idx + 1}</span>
                          <span className="font-semibold text-emerald-400 tabular-nums">
                            {item.matchRatePct.toFixed(1)}%
                          </span>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-100">
                          {item.targetTimeframe} {item.targetSlotKey}
                        </p>
                        <p className="font-mono text-[10px] text-slate-400 tabular-nums">
                          {item.matchedDays}/{item.totalCoOccurringDays}d · {item.bullishMatches}B/
                          {item.bearishMatches}S
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Day Filter & Pagination Bar */}
          {activeIntradayPair && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E293B] bg-[#0B0F17] px-6 py-3">
              <div className="flex flex-wrap items-center gap-1 rounded border border-[#1E293B] bg-[#111824] p-1">
                {(
                  [
                    { id: 'all', label: `All Days (${intradayCounts.all})` },
                    { id: 'match', label: `Matched (${intradayCounts.match})` },
                    { id: 'mismatch', label: `Failed / Doji (${intradayCounts.mismatch})` },
                  ] as { id: IntradayDayFilter; label: string }[]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setIntradayDayFilter(tab.id);
                      setPage(1);
                    }}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      intradayDayFilter === tab.id
                        ? 'bg-[#1E293B] text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-2 font-mono text-xs tabular-nums text-slate-400">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous calendar page"
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <span>
                    Page {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next calendar page"
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
                  >
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Day-by-Day Table with Side-by-Side Candlestick Glyphs */}
          <div className="flex-1 overflow-auto">
            {!activeIntradayPair ? (
              <div className="px-6 py-12 text-center text-xs text-slate-500">
                No target slot available for inspection under current filters.
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Calendar Date (UTC)</th>
                    <th className="px-3 py-2.5 font-medium">Anchor Candle</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      Anchor ({activeIntradayPair.anchorTimeframe} {activeIntradayPair.anchorSlotKey})
                    </th>
                    <th className="px-3 py-2.5 font-medium">Target Candle</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      Target ({activeIntradayPair.targetTimeframe} {activeIntradayPair.targetSlotKey})
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B] font-mono tabular-nums">
                  {pageDays.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center font-sans text-slate-500">
                        No calendar days match this filter.
                      </td>
                    </tr>
                  ) : (
                    pageDays.map((r) => (
                      <tr
                        key={`${r.dateStr}-${r.anchorCandle.timestamp}-${r.targetCandle.timestamp}`}
                        className={
                          r.isMatch
                            ? 'hover:bg-emerald-500/[0.04]'
                            : 'bg-red-500/[0.03] hover:bg-red-500/[0.06]'
                        }
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-200">
                          {r.dateStr}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <SingleCandleGlyph candle={r.anchorCandle} width={16} height={26} />
                            <span
                              className={`text-[11px] font-semibold ${
                                r.anchorCandle.candleType === 'BULLISH'
                                  ? 'text-emerald-400'
                                  : r.anchorCandle.candleType === 'BEARISH'
                                    ? 'text-red-400'
                                    : 'text-amber-400'
                              }`}
                            >
                              {r.anchorCandle.candleType}
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-300">
                          <div>
                            O {r.anchorCandle.open} · H {r.anchorCandle.high}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            L {r.anchorCandle.low} · C {r.anchorCandle.close}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <SingleCandleGlyph candle={r.targetCandle} width={16} height={26} />
                            <span
                              className={`text-[11px] font-semibold ${
                                r.targetCandle.candleType === 'BULLISH'
                                  ? 'text-emerald-400'
                                  : r.targetCandle.candleType === 'BEARISH'
                                    ? 'text-red-400'
                                    : 'text-amber-400'
                              }`}
                            >
                              {r.targetCandle.candleType}
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-300">
                          <div>
                            O {r.targetCandle.open} · H {r.targetCandle.high}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            L {r.targetCandle.low} · C {r.targetCandle.close}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">
                          {r.isMatch ? (
                            <span className="text-emerald-400">MATCH ({r.matchDirection})</span>
                          ) : r.targetCandle.candleType === 'DOJI' ? (
                            <span className="text-amber-400">TARGET DOJI</span>
                          ) : (
                            <span className="text-red-400">MISMATCH</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // BEST MATCHED CANDLES INSPECTION VIEW
  // =========================================================================
  if (bestMatch) {
    const isSingleFile = bestMatchScope === 'single_file';
    const hasReference = Boolean(referenceSnapshots && referenceSnapshots.length > 0);

    return (
      <div
        className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drilldown-match-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="flex h-full w-full max-w-5xl flex-col border-l border-[#1E293B] bg-[#0B0F17] shadow-2xl">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-[#1E293B] bg-[#111824] px-6 py-5">
            <div className="space-y-1">
              <p className="text-xs font-medium text-amber-400">
                Match Verification Breakdown · Rank #{bestMatch.rank} ·{' '}
                {isSingleFile ? 'Single-File Pattern Search' : 'Cross-Timeframe Alignment'}
              </p>
              <h2
                id="drilldown-match-title"
                className="font-mono text-xl font-bold text-slate-50"
              >
                {bestMatch.timeStr}{' '}
                <span className="text-sm font-normal text-slate-400">
                  ({bestMatch.patternLabel})
                </span>
              </h2>
              <p className="font-mono text-xs tabular-nums text-slate-400">
                Window End: {bestMatch.endTimeStr} UTC · Anchor {bestMatch.anchorTimeframe}
              </p>
            </div>

            <button
              type="button"
              aria-label="Close match inspection drawer"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#1E293B] bg-[#0B0F17] text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Score Breakdown Strip */}
          <div className="grid grid-cols-2 divide-x divide-y divide-[#1E293B] border-b border-[#1E293B] bg-[#0D131E] sm:grid-cols-5 sm:divide-y-0">
            <div className="px-4 py-3">
              <p className="text-[11px] text-slate-400">Composite Match</p>
              <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-400">
                {bestMatch.matchScore.toFixed(2)}%
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] text-slate-400">Directional Align</p>
              <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-100">
                {bestMatch.directionalScore.toFixed(1)}%
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] text-slate-400">Structural Similarity</p>
              <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-sky-300">
                {bestMatch.structuralScore.toFixed(1)}%
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] text-slate-400">Volume Similarity</p>
              <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-200">
                {bestMatch.volumeScore !== null ? `${bestMatch.volumeScore.toFixed(1)}%` : 'Off'}
              </p>
            </div>
            <div className="col-span-2 px-4 py-3 sm:col-span-1">
              <p className="text-[11px] text-slate-400">Dominant Polarity</p>
              <p
                className={`mt-0.5 font-mono text-base font-semibold ${
                  bestMatch.dominantDirection === 'BULLISH'
                    ? 'text-emerald-400'
                    : bestMatch.dominantDirection === 'BEARISH'
                      ? 'text-red-400'
                      : 'text-amber-400'
                }`}
              >
                {bestMatch.dominantDirection}
              </p>
            </div>
          </div>

          {/* Scrollable Body: Candlestick Geometry Comparison + Full OHLCV Table */}
          <div className="flex-1 space-y-6 overflow-auto p-6">
            {/* Visual Candlestick Geometry Comparison */}
            <section aria-label="Visual candlestick geometry comparison" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Candlestick Geometry Comparison
                </h3>
                <span className="text-[11px] text-slate-500">
                  {hasReference
                    ? 'Normalized sequence scale per window (shape & wick proportions)'
                    : isSingleFile
                      ? 'Shared price scale across matched sequence bars'
                      : 'Independent price scale per timeframe to compare body & wick geometry'}
                </span>
              </div>

              {hasReference && referenceSnapshots ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <CandlestickComparisonPanel
                    title="Target Reference Pattern"
                    subtitle={referenceSnapshots[0]?.candle.timeStr ?? ''}
                    snapshots={referenceSnapshots}
                    sharedScale={true}
                  />
                  <CandlestickComparisonPanel
                    title={`Historical Match (#${bestMatch.rank})`}
                    subtitle={bestMatch.timeStr}
                    snapshots={bestMatch.snapshots}
                    sharedScale={true}
                  />
                </div>
              ) : (
                <CandlestickComparisonPanel
                  title={
                    isSingleFile
                      ? `Matched ${bestMatch.snapshots.length}-Bar Setup`
                      : `Aligned ${bestMatch.snapshots.length}-Timeframe Snapshot`
                  }
                  subtitle={bestMatch.summaryDetail}
                  snapshots={bestMatch.snapshots}
                  sharedScale={isSingleFile}
                />
              )}
            </section>

            {/* Full OHLCV & Structural Vector Breakdown Table */}
            <section aria-label="OHLCV and structural feature breakdown" className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Full OHLCV &amp; Structural Feature Vector
              </h3>

              <div className="overflow-hidden rounded border border-[#1E293B] bg-[#111824]">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
                        <th className="px-3.5 py-2.5 font-medium">Role / TF</th>
                        <th className="px-3.5 py-2.5 font-medium">Time (UTC)</th>
                        <th className="px-3 py-2.5 text-right font-medium">Open</th>
                        <th className="px-3 py-2.5 text-right font-medium">High</th>
                        <th className="px-3 py-2.5 text-right font-medium">Low</th>
                        <th className="px-3 py-2.5 text-right font-medium">Close</th>
                        <th className="px-3 py-2.5 text-right font-medium">Volume</th>
                        <th className="px-3 py-2.5 font-medium">Type</th>
                        <th className="px-3 py-2.5 text-right font-medium">Body %</th>
                        <th className="px-3 py-2.5 text-right font-medium">Up Wick %</th>
                        <th className="px-3 py-2.5 text-right font-medium">Low Wick %</th>
                        <th className="px-3 py-2.5 text-right font-medium">Range/ATR</th>
                        <th className="px-3.5 py-2.5 text-right font-medium">Vol Ratio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E293B] font-mono tabular-nums">
                      {bestMatch.snapshots.map((s, idx) => (
                        <tr key={`match-${s.timeframe}-${s.candle.timestamp}-${idx}`} className="hover:bg-[#162032]/60">
                          <td className="whitespace-nowrap px-3.5 py-2.5 font-semibold text-slate-100">
                            {s.roleLabel}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 text-slate-300">
                            {s.candle.timeStr}
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-300">{s.candle.open}</td>
                          <td className="px-3 py-2.5 text-right text-slate-300">{s.candle.high}</td>
                          <td className="px-3 py-2.5 text-right text-slate-300">{s.candle.low}</td>
                          <td className="px-3 py-2.5 text-right text-slate-200">{s.candle.close}</td>
                          <td className="px-3 py-2.5 text-right text-slate-400">
                            {formatDecimal(s.candle.volume, 4)}
                          </td>
                          <td
                            className={`px-3 py-2.5 font-semibold ${
                              s.candle.candleType === 'BULLISH'
                                ? 'text-emerald-400'
                                : s.candle.candleType === 'BEARISH'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                            }`}
                          >
                            {s.candle.candleType}
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-100">
                            {(s.features.bodyRatio * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-300">
                            {(s.features.upperWickRatio * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-300">
                            {(s.features.lowerWickRatio * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-2.5 text-right text-sky-300">
                            {s.features.rangeAtrRatio.toFixed(2)}x
                          </td>
                          <td className="px-3.5 py-2.5 text-right text-amber-300">
                            {s.features.volumeRatio.toFixed(2)}x
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // PRINCIPAL VS TARGET DATE-BY-DATE BREAKDOWN VIEW (EXISTING)
  // =========================================================================
  if (!candidate) return null;

  const totalPages = Math.max(1, Math.ceil(filteredPairs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = filteredPairs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drilldown-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-4xl flex-col border-l border-[#1E293B] bg-[#0B0F17] shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#1E293B] bg-[#111824] px-6 py-5">
          <div className="space-y-1">
            <p className="text-xs font-medium text-amber-400">
              Date-by-Date Verification Breakdown · {targetDescription}
            </p>
            <h2
              id="drilldown-title"
              className="font-mono text-xl font-bold text-slate-50"
            >
              {candidate.slotLabel}{' '}
              <span className="text-sm font-normal text-slate-400">
                ({candidate.searchTimeframe})
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              {candidate.timingRelation} · {candidate.timingDetail}
            </p>
          </div>

          <button
            type="button"
            aria-label="Close drill-down breakdown"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#1E293B] bg-[#0B0F17] text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Summary Metrics Bar */}
        <div className="grid grid-cols-2 divide-x divide-y divide-[#1E293B] border-b border-[#1E293B] bg-[#0D131E] sm:grid-cols-5 sm:divide-y-0">
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Overall Alignment</p>
            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-400">
              {candidate.overallAlignmentScore.toFixed(2)}%
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Bullish Match</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-100">
              {candidate.bullishMatchRate !== null ? `${candidate.bullishMatchRate.toFixed(1)}%` : '—'}{' '}
              <span className="text-xs font-normal text-slate-500">
                ({candidate.bullishMatches}/{candidate.targetBullishCount})
              </span>
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Bearish Match</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-100">
              {candidate.bearishMatchRate !== null ? `${candidate.bearishMatchRate.toFixed(1)}%` : '—'}{' '}
              <span className="text-xs font-normal text-slate-500">
                ({candidate.bearishMatches}/{candidate.targetBearishCount})
              </span>
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Valid Pairs (N)</p>
            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-100">
              {candidate.totalValidPairs.toLocaleString()}
            </p>
          </div>
          <div className="col-span-2 px-4 py-3 sm:col-span-1">
            <p className="text-[11px] text-slate-400">Excluded Dojis</p>
            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-amber-400">
              {candidate.excludedDojiPairs.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E293B] bg-[#0B0F17] px-6 py-3">
          <div className="flex flex-wrap items-center gap-1 rounded border border-[#1E293B] bg-[#111824] p-1">
            {(
              [
                { id: 'all', label: `All (${counts.all})` },
                { id: 'match', label: `Matches (${counts.match})` },
                { id: 'mismatch', label: `Mismatches (${counts.mismatch})` },
                { id: 'doji', label: `Excluded Dojis (${counts.doji})` },
              ] as { id: PairFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setPairFilter(tab.id);
                  setPage(1);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  pairFilter === tab.id
                    ? 'bg-[#1E293B] text-amber-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-2 font-mono text-xs tabular-nums text-slate-400">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span>
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Date-by-Date Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">Cycle Date (UTC)</th>
                <th className="px-4 py-2.5 text-right font-medium">Target O / C</th>
                <th className="px-4 py-2.5 font-medium">Target Type</th>
                <th className="px-4 py-2.5 font-medium">Principal Time (UTC)</th>
                <th className="px-4 py-2.5 text-right font-medium">Principal O / C</th>
                <th className="px-4 py-2.5 font-medium">Principal Type</th>
                <th className="px-4 py-2.5 text-right font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E293B] font-mono tabular-nums">
              {pageSlice.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center font-sans text-slate-500">
                    No historical pairs match this filter.
                  </td>
                </tr>
              ) : (
                pageSlice.map((p) => (
                  <tr
                    key={`${p.cycleKey}-${p.principalTimestamp}`}
                    className={
                      p.isDojiExcluded
                        ? 'bg-amber-500/[0.03] text-slate-400'
                        : p.isMatch
                          ? 'hover:bg-emerald-500/[0.04]'
                          : 'bg-red-500/[0.03] hover:bg-red-500/[0.06]'
                    }
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-200">
                      {p.cycleDateStr}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-300">
                      {p.targetOpen} → {p.targetClose}
                      <span className="block text-[10px] text-slate-500">
                        Δ {p.targetDiff > 0 ? `+${formatDecimal(p.targetDiff)}` : formatDecimal(p.targetDiff)}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2.5 font-semibold ${
                        p.targetType === 'BULLISH'
                          ? 'text-emerald-400'
                          : p.targetType === 'BEARISH'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {p.targetType}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-300">
                      {p.principalTimeStr}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-300">
                      {p.principalOpen} → {p.principalClose}
                      <span className="block text-[10px] text-slate-500">
                        Δ {p.principalDiff > 0 ? `+${formatDecimal(p.principalDiff)}` : formatDecimal(p.principalDiff)}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2.5 font-semibold ${
                        p.principalType === 'BULLISH'
                          ? 'text-emerald-400'
                          : p.principalType === 'BEARISH'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {p.principalType}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">
                      {p.isDojiExcluded ? (
                        <span className="text-amber-400">DOJI EXCLUDED</span>
                      ) : p.isMatch ? (
                        <span className="text-emerald-400">MATCH</span>
                      ) : (
                        <span className="text-red-400">MISMATCH</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

