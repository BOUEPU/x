import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import {
  filterAndRankBestMatches,
  filterAndRankCandidates,
  filterAndRankIntradayMatches,
  filterIntradayMatrixSummaries,
  getDirectionScore,
} from '../engine/correlation';
import {
  downloadBestMatchesCsv,
  downloadCorrelationResultsCsv,
  downloadIntradayMatrixCsv,
  downloadIntradaySlotMatchesCsv,
} from '../engine/csvExport';
import {
  exportBestMatchesReportPdf,
  exportCorrelationReportPdf,
  exportIntradaySlotReportPdf,
} from '../engine/pdfExport';
import {
  AnalysisResult,
  BestMatchEngineSubMode,
  BestMatchFilterState,
  BestMatchItem,
  BestMatchResult,
  CandleType,
  DirectionFilter,
  IntradayFullMatrixAnchorSummary,
  IntradaySlotFilterState,
  IntradaySlotMatchItem,
  IntradaySlotMatchResult,
  PrincipalCandidateResult,
  ResultsFilterState,
  StepEngineMode,
  TimeframeDataset,
  TimeframeId,
  TIMEFRAME_MAP,
  TimingRelation,
} from '../engine/types';
import { SnapshotStripGlyphs } from './CandleGlyph';
import { DrillDownDrawer } from './DrillDownDrawer';
import { TopBarChart } from './TopBarChart';

interface StepResultsProps {
  engineMode: StepEngineMode;
  bestMatchSubMode: BestMatchEngineSubMode;
  // Principal vs Target props
  result: AnalysisResult | null;
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>;
  filters: ResultsFilterState;
  onChangeFilters: (next: ResultsFilterState) => void;
  onDateRangeChange: (startDateUtc: string, endDateUtc: string) => void;
  // Best Matched Candles (Geometric / Multi-TF) props
  bestMatchResult: BestMatchResult | null;
  bestMatchFilters: BestMatchFilterState;
  onChangeBestMatchFilters: (next: BestMatchFilterState) => void;
  // Intraday Time-Slot Direction Correlation props
  intradayResult: IntradaySlotMatchResult | null;
  intradayFilters: IntradaySlotFilterState;
  onChangeIntradayFilters: (next: IntradaySlotFilterState) => void;
  onBackToConfigure: () => void;
}

type SortKey =
  | 'rank'
  | 'slotLabel'
  | 'overallAlignmentScore'
  | 'bullishMatchRate'
  | 'bearishMatchRate'
  | 'totalValidPairs'
  | 'excludedDojiPairs'
  | 'timingRelation';

type MatchSortKey =
  | 'rank'
  | 'timestamp'
  | 'matchScore'
  | 'directionalScore'
  | 'structuralScore'
  | 'volumeScore'
  | 'dominantDirection';

type IntradayMatchSortKey =
  | 'rank'
  | 'targetTimeframe'
  | 'targetSlot'
  | 'matchedDays'
  | 'matchRatePct'
  | 'bullishMatches'
  | 'bearishMatches';

type IntradayMatrixSortKey =
  | 'anchorSlot'
  | 'validDays'
  | 'bestTarget'
  | 'matchedDays'
  | 'matchRatePct'
  | 'top5Avg';

function renderTimingTag(relation: TimingRelation, detail: string) {
  const styles =
    relation === 'BEFORE'
      ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
      : relation === 'INSIDE'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-slate-600/60 bg-slate-800/80 text-slate-300';

  const label =
    relation === 'BEFORE' ? 'Before' : relation === 'INSIDE' ? 'Inside' : 'After';

  return (
    <span
      title={detail}
      className={`inline-flex items-center whitespace-nowrap rounded-[3px] border px-2 py-0.5 text-[11px] font-medium ${styles}`}
    >
      {label}
    </span>
  );
}

function renderDirectionLabel(dir: CandleType) {
  if (dir === 'BULLISH') {
    return <span className="font-mono font-semibold text-emerald-400">BULLISH</span>;
  }
  if (dir === 'BEARISH') {
    return <span className="font-mono font-semibold text-red-400">BEARISH</span>;
  }
  return <span className="font-mono font-semibold text-amber-400">DOJI</span>;
}

export function StepResults({
  engineMode,
  bestMatchSubMode,
  result,
  datasets,
  filters,
  onChangeFilters,
  onDateRangeChange,
  bestMatchResult,
  bestMatchFilters,
  onChangeBestMatchFilters,
  intradayResult,
  intradayFilters,
  onChangeIntradayFilters,
  onBackToConfigure,
}: StepResultsProps) {
  // Principal vs Target state
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedCandidate, setSelectedCandidate] =
    useState<PrincipalCandidateResult | null>(null);

  // Best Matched Candles (Geometric / Multi-TF) state
  const [matchSortKey, setMatchSortKey] = useState<MatchSortKey>('rank');
  const [matchSortDir, setMatchSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedMatch, setSelectedMatch] = useState<BestMatchItem | null>(null);

  // Intraday Time-Slot Match state
  const [intradaySortKey, setIntradaySortKey] = useState<IntradayMatchSortKey>('rank');
  const [intradaySortDir, setIntradaySortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIntradayMatch, setSelectedIntradayMatch] =
    useState<IntradaySlotMatchItem | null>(null);

  // Intraday Full-Matrix Leaderboard state
  const [matrixSortKey, setMatrixSortKey] = useState<IntradayMatrixSortKey>('matchRatePct');
  const [matrixSortDir, setMatrixSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedMatrixRow, setSelectedMatrixRow] =
    useState<IntradayFullMatrixAnchorSummary | null>(null);
  const [matrixPage, setMatrixPage] = useState(1);
  const [matrixPageSize, setMatrixPageSize] = useState(100);

  // =========================================================================
  // INTRADAY TIME-SLOT CORRELATION COMPUTED DATA
  // =========================================================================
  const filteredIntradayMatches = useMemo(() => {
    if (!intradayResult || intradayResult.scopeMode !== 'single_anchor') return [];
    return filterAndRankIntradayMatches(intradayResult.matches, intradayFilters);
  }, [intradayResult, intradayFilters]);

  const rankedIntradayWithIndex = useMemo(
    () => filteredIntradayMatches.map((m, idx) => ({ match: m, rank: idx + 1 })),
    [filteredIntradayMatches]
  );

  const displayedIntradayMatches = useMemo(() => {
    if (intradaySortKey === 'rank' && intradaySortDir === 'asc') {
      return rankedIntradayWithIndex;
    }
    return rankedIntradayWithIndex.slice().sort((a, b) => {
      const ma = a.match;
      const mb = b.match;
      let cmp = 0;
      switch (intradaySortKey) {
        case 'rank':
          cmp = a.rank - b.rank;
          break;
        case 'targetTimeframe':
          cmp =
            TIMEFRAME_MAP[ma.targetTimeframe].rankOrder -
            TIMEFRAME_MAP[mb.targetTimeframe].rankOrder;
          break;
        case 'targetSlot':
          cmp = ma.targetSlotSortOrder - mb.targetSlotSortOrder;
          break;
        case 'matchedDays':
          cmp = ma.matchedDays - mb.matchedDays;
          break;
        case 'matchRatePct':
          cmp = ma.matchRatePct - mb.matchRatePct;
          break;
        case 'bullishMatches':
          cmp = ma.bullishMatches - mb.bullishMatches;
          break;
        case 'bearishMatches':
          cmp = ma.bearishMatches - mb.bearishMatches;
          break;
      }
      return intradaySortDir === 'asc' ? cmp : -cmp;
    });
  }, [rankedIntradayWithIndex, intradaySortKey, intradaySortDir]);

  const filteredMatrixSummaries = useMemo(() => {
    if (!intradayResult || intradayResult.scopeMode !== 'full_matrix') return [];
    return filterIntradayMatrixSummaries(intradayResult.matrixSummaries, intradayFilters);
  }, [intradayResult, intradayFilters]);

  const displayedMatrixRows = useMemo(() => {
    const arr = filteredMatrixSummaries.slice();
    arr.sort((a, b) => {
      let cmp = 0;
      switch (matrixSortKey) {
        case 'anchorSlot':
          cmp = a.anchorSlotSortOrder - b.anchorSlotSortOrder;
          break;
        case 'validDays':
          cmp = a.totalValidAnchorDays - b.totalValidAnchorDays;
          break;
        case 'bestTarget': {
          const ba = a.bestTarget ? `${a.bestTarget.targetTimeframe}_${a.bestTarget.targetSlotKey}` : '';
          const bb = b.bestTarget ? `${b.bestTarget.targetTimeframe}_${b.bestTarget.targetSlotKey}` : '';
          cmp = ba.localeCompare(bb);
          break;
        }
        case 'matchedDays':
          cmp = (a.bestTarget?.matchedDays ?? -1) - (b.bestTarget?.matchedDays ?? -1);
          break;
        case 'matchRatePct':
          cmp = (a.bestTarget?.matchRatePct ?? -1) - (b.bestTarget?.matchRatePct ?? -1);
          if (cmp === 0) {
            cmp = (a.bestTarget?.matchedDays ?? -1) - (b.bestTarget?.matchedDays ?? -1);
          }
          break;
        case 'top5Avg':
          cmp = a.top5AvgMatchRatePct - b.top5AvgMatchRatePct;
          break;
      }
      return matrixSortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredMatrixSummaries, matrixSortKey, matrixSortDir]);

  const strongestMatrixRow = useMemo(() => {
    let best: IntradayFullMatrixAnchorSummary | null = null;
    for (const row of filteredMatrixSummaries) {
      if (!row.bestTarget) continue;
      if (
        !best ||
        !best.bestTarget ||
        row.bestTarget.matchRatePct > best.bestTarget.matchRatePct ||
        (row.bestTarget.matchRatePct === best.bestTarget.matchRatePct &&
          row.bestTarget.matchedDays > best.bestTarget.matchedDays)
      ) {
        best = row;
      }
    }
    return best;
  }, [filteredMatrixSummaries]);

  // =========================================================================
  // BEST MATCHED CANDLES (GEOMETRIC / MULTI-TF) COMPUTED DATA
  // =========================================================================
  const filteredMatches = useMemo(() => {
    if (!bestMatchResult) return [];
    return filterAndRankBestMatches(bestMatchResult.matches, bestMatchFilters);
  }, [bestMatchResult, bestMatchFilters]);

  const rankedMatchesWithIndex = useMemo(
    () => filteredMatches.map((m, idx) => ({ match: m, rank: idx + 1 })),
    [filteredMatches]
  );

  const displayedMatches = useMemo(() => {
    if (matchSortKey === 'rank' && matchSortDir === 'asc') return rankedMatchesWithIndex;
    return rankedMatchesWithIndex.slice().sort((a, b) => {
      const ma = a.match;
      const mb = b.match;
      let cmp = 0;
      switch (matchSortKey) {
        case 'rank':
          cmp = a.rank - b.rank;
          break;
        case 'timestamp':
          cmp = ma.timestamp - mb.timestamp;
          break;
        case 'matchScore':
          cmp = ma.matchScore - mb.matchScore;
          break;
        case 'directionalScore':
          cmp = ma.directionalScore - mb.directionalScore;
          break;
        case 'structuralScore':
          cmp = ma.structuralScore - mb.structuralScore;
          break;
        case 'volumeScore':
          cmp = (ma.volumeScore ?? -1) - (mb.volumeScore ?? -1);
          break;
        case 'dominantDirection':
          cmp = ma.dominantDirection.localeCompare(mb.dominantDirection);
          break;
      }
      return matchSortDir === 'asc' ? cmp : -cmp;
    });
  }, [rankedMatchesWithIndex, matchSortKey, matchSortDir]);

  const avgStructuralSim = useMemo(() => {
    if (filteredMatches.length === 0) return 0;
    return (
      filteredMatches.reduce((acc, m) => acc + m.structuralScore, 0) /
      filteredMatches.length
    );
  }, [filteredMatches]);

  // =========================================================================
  // PRINCIPAL VS TARGET COMPUTED DATA
  // =========================================================================
  const rankedCandidates = useMemo(
    () => (result ? filterAndRankCandidates(result.candidates, filters) : []),
    [result, filters]
  );

  const rankedWithIndex = useMemo(
    () => rankedCandidates.map((c, idx) => ({ candidate: c, rank: idx + 1 })),
    [rankedCandidates]
  );

  const displayedRows = useMemo(() => {
    if (sortKey === 'rank' && sortDir === 'asc') return rankedWithIndex;

    const sorted = rankedWithIndex.slice().sort((a, b) => {
      const ca = a.candidate;
      const cb = b.candidate;
      let cmp = 0;

      switch (sortKey) {
        case 'rank':
          cmp = a.rank - b.rank;
          break;
        case 'slotLabel':
          cmp = ca.slotSortOrder - cb.slotSortOrder;
          break;
        case 'overallAlignmentScore':
          cmp = ca.overallAlignmentScore - cb.overallAlignmentScore;
          break;
        case 'bullishMatchRate':
          cmp = (ca.bullishMatchRate ?? -1) - (cb.bullishMatchRate ?? -1);
          break;
        case 'bearishMatchRate':
          cmp = (ca.bearishMatchRate ?? -1) - (cb.bearishMatchRate ?? -1);
          break;
        case 'totalValidPairs':
          cmp = ca.totalValidPairs - cb.totalValidPairs;
          break;
        case 'excludedDojiPairs':
          cmp = ca.excludedDojiPairs - cb.excludedDojiPairs;
          break;
        case 'timingRelation': {
          const order: Record<TimingRelation, number> = { BEFORE: 0, INSIDE: 1, AFTER: 2 };
          cmp = order[ca.timingRelation] - order[cb.timingRelation];
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [rankedWithIndex, sortKey, sortDir]);

  // =========================================================================
  // VIEW 1A: INTRADAY TIME-SLOT DIRECTION CORRELATION DASHBOARD
  // =========================================================================
  if (
    engineMode === 'best_matches' &&
    bestMatchSubMode === 'intraday_slot' &&
    intradayResult
  ) {
    const isSingleAnchor = intradayResult.scopeMode === 'single_anchor';
    const topSingle = filteredIntradayMatches[0] ?? null;

    const handleResetIntradayFilters = () => {
      onChangeIntradayFilters({
        searchQuery: '',
        targetTimeframeFilter: 'ALL',
        directionBiasFilter: 'all',
        minRateOverride: 0,
      });
      setMatrixPage(1);
    };

    const handleIntradaySort = (key: IntradayMatchSortKey) => {
      if (intradaySortKey === key) {
        setIntradaySortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setIntradaySortKey(key);
        setIntradaySortDir(
          key === 'rank' || key === 'targetTimeframe' || key === 'targetSlot' ? 'asc' : 'desc'
        );
      }
    };

    const renderIntradaySortIcon = (key: IntradayMatchSortKey) => {
      if (intradaySortKey !== key) {
        return <ArrowUpDown className="h-3 w-3 text-slate-600" aria-hidden="true" />;
      }
      return intradaySortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3 text-amber-400" aria-hidden="true" />
      ) : (
        <ArrowDown className="h-3 w-3 text-amber-400" aria-hidden="true" />
      );
    };

    const handleMatrixSort = (key: IntradayMatrixSortKey) => {
      if (matrixSortKey === key) {
        setMatrixSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setMatrixSortKey(key);
        setMatrixSortDir(key === 'anchorSlot' ? 'asc' : 'desc');
      }
      setMatrixPage(1);
    };

    const renderMatrixSortIcon = (key: IntradayMatrixSortKey) => {
      if (matrixSortKey !== key) {
        return <ArrowUpDown className="h-3 w-3 text-slate-600" aria-hidden="true" />;
      }
      return matrixSortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3 text-amber-400" aria-hidden="true" />
      ) : (
        <ArrowDown className="h-3 w-3 text-amber-400" aria-hidden="true" />
      );
    };

    const totalMatrixPages = Math.max(1, Math.ceil(displayedMatrixRows.length / matrixPageSize));
    const safeMatrixPage = Math.min(matrixPage, totalMatrixPages);
    const pageMatrixRows = displayedMatrixRows.slice(
      (safeMatrixPage - 1) * matrixPageSize,
      safeMatrixPage * matrixPageSize
    );

    return (
      <div className="space-y-6">
        {/* Header & Exports */}
        <div className="flex flex-col justify-between gap-4 border-b border-[#1E293B] pb-6 lg:flex-row lg:items-end">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-amber-400">
              Step 4 of 4 ·{' '}
              {isSingleAnchor
                ? 'Daily Intraday Time-Slot Direction Match'
                : 'Full-Matrix Intraday Time-Slot Collection'}
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
              {isSingleAnchor
                ? `Anchor ${intradayResult.anchorTimeframe} (${intradayResult.anchorSlotKey} UTC) Recurring Slot Matches`
                : `Master Intraday Slot Correlation Matrix (${intradayResult.anchorTimeframe})`}
            </h1>
            <p className="text-xs text-slate-400">
              <span>
                Targets: {intradayResult.targetTimeframes.join(', ')}
              </span>
              <span aria-hidden="true" className="mx-2 text-slate-600">·</span>
              <span>
                Filter:{' '}
                {intradayResult.config.directionFilter === 'any_non_doji'
                  ? 'Bullish & Bearish'
                  : intradayResult.config.directionFilter === 'bullish_only'
                    ? 'Bullish Anchor Only'
                    : 'Bearish Anchor Only'}
              </span>
              <span aria-hidden="true" className="mx-2 text-slate-600">·</span>
              <span className="font-mono tabular-nums">
                Computed in {intradayResult.computeDurationMs.toFixed(1)} ms
              </span>
              {intradayResult.usedWorker && (
                <>
                  <span aria-hidden="true" className="mx-2 text-slate-600">·</span>
                  <span>Off-Thread Worker</span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onBackToConfigure}
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#1E293B] bg-[#111824] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-[#162032]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <span>Modify Search</span>
            </button>

            <button
              type="button"
              onClick={() =>
                isSingleAnchor
                  ? downloadIntradaySlotMatchesCsv(intradayResult, filteredIntradayMatches)
                  : downloadIntradayMatrixCsv(intradayResult, displayedMatrixRows)
              }
              disabled={
                isSingleAnchor
                  ? filteredIntradayMatches.length === 0
                  : displayedMatrixRows.length === 0
              }
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#2A3950] bg-[#111824] px-3.5 text-xs font-medium text-slate-100 transition-colors hover:border-amber-500/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isSingleAnchor ? 'Export Matches CSV' : 'Export Matrix CSV'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                exportIntradaySlotReportPdf(
                  intradayResult,
                  filteredIntradayMatches,
                  displayedMatrixRows,
                  intradayFilters
                )
              }
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded bg-amber-500 px-4 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download PDF Report</span>
            </button>
          </div>
        </div>

        {/* Warning Banner */}
        {intradayResult.warningMessage && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <p className="leading-relaxed">{intradayResult.warningMessage}</p>
          </div>
        )}

        {/* 5 KPI Summary Cards */}
        <section
          aria-label="Intraday time-slot correlation summary KPIs"
          className="grid grid-cols-2 divide-y divide-[#1E293B] rounded border border-[#1E293B] bg-[#111824] md:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-y-0"
        >
          <div className="p-4">
            <p className="text-[11px] text-slate-400">
              {isSingleAnchor ? 'Anchor Time Slot' : 'Anchor Timeframe'}
            </p>
            <p className="mt-1 truncate font-mono text-sm font-semibold text-slate-100">
              {isSingleAnchor
                ? `${intradayResult.anchorTimeframe} · ${intradayResult.anchorSlotKey} UTC`
                : `${intradayResult.anchorTimeframe} · All Slots`}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              {isSingleAnchor
                ? `Exclude Self: ${intradayResult.config.excludeSelfSlot ? 'Yes' : 'No'}`
                : `${intradayResult.totalAnchorSlotsEvaluated.toLocaleString()} slots evaluated`}
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">Valid UTC Days Evaluated</p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-100">
              {intradayResult.totalValidDaysEvaluated.toLocaleString()}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-slate-500">
              {intradayResult.effectiveStartUtc ?? '—'} → {intradayResult.effectiveEndUtc ?? '—'}
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">
              {isSingleAnchor ? '#1 Best Matched Slot' : 'Strongest Anchor → Target'}
            </p>
            <p className="mt-1 truncate font-mono text-sm font-semibold text-emerald-400">
              {isSingleAnchor
                ? topSingle
                  ? `${topSingle.targetTimeframe} · ${topSingle.targetSlotKey} UTC`
                  : '—'
                : strongestMatrixRow?.bestTarget
                  ? `${strongestMatrixRow.anchorSlotKey} → ${strongestMatrixRow.bestTarget.targetTimeframe} ${strongestMatrixRow.bestTarget.targetSlotKey}`
                  : '—'}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              {isSingleAnchor
                ? topSingle
                  ? `${topSingle.matchedDays} / ${topSingle.totalCoOccurringDays} same-day matches`
                  : 'No qualifying target'
                : strongestMatrixRow?.bestTarget
                  ? `${strongestMatrixRow.bestTarget.matchedDays} / ${strongestMatrixRow.bestTarget.totalCoOccurringDays} days`
                  : 'No qualifying pair'}
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">
              {isSingleAnchor ? 'Highest Match Rate (%)' : 'Peak Match Rate (%)'}
            </p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-emerald-400">
              {isSingleAnchor
                ? topSingle
                  ? `${topSingle.matchRatePct.toFixed(2)}%`
                  : '—'
                : strongestMatrixRow?.bestTarget
                  ? `${strongestMatrixRow.bestTarget.matchRatePct.toFixed(2)}%`
                  : '—'}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              Min ≥{intradayResult.config.minMatchRatePct}% · Min N=
              {intradayResult.config.minCoOccurringDays}
            </p>
          </div>

          <div className="col-span-2 p-4 md:col-span-1">
            <p className="text-[11px] text-slate-400">
              {isSingleAnchor ? 'Qualifying Slots Found' : 'Pairwise Slot Evaluations'}
            </p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-100">
              {isSingleAnchor
                ? filteredIntradayMatches.length.toLocaleString()
                : intradayResult.totalPairwiseEvaluations.toLocaleString()}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              {isSingleAnchor
                ? `of ${intradayResult.totalPairwiseEvaluations.toLocaleString()} candidate slots`
                : `Showing ${displayedMatrixRows.length.toLocaleString()} anchor slots`}
            </p>
          </div>
        </section>

        {/* Interactive Filter Toolbar */}
        <section
          aria-label="Intraday slot filters"
          className="flex flex-wrap items-center justify-between gap-4 rounded border border-[#1E293B] bg-[#111824] p-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-60">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                type="text"
                value={intradayFilters.searchQuery}
                onChange={(e) => {
                  onChangeIntradayFilters({
                    ...intradayFilters,
                    searchQuery: e.target.value,
                  });
                  setMatrixPage(1);
                }}
                placeholder={
                  isSingleAnchor
                    ? 'Search target slot e.g. 14:30, 1H...'
                    : 'Search anchor or target slot...'
                }
                aria-label="Search intraday time slots"
                className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
              />
            </div>

            {intradayResult.targetTimeframes.length > 1 && (
              <select
                aria-label="Filter by target timeframe"
                value={intradayFilters.targetTimeframeFilter}
                onChange={(e) => {
                  onChangeIntradayFilters({
                    ...intradayFilters,
                    targetTimeframeFilter: e.target.value as TimeframeId | 'ALL',
                  });
                  setMatrixPage(1);
                }}
                className="h-9 rounded border border-[#2A3950] bg-[#0B0F17] px-2.5 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="ALL">All Target TFs ({intradayResult.targetTimeframes.length})</option>
                {intradayResult.targetTimeframes.map((tf) => (
                  <option key={tf} value={tf}>
                    Target: {tf}
                  </option>
                ))}
              </select>
            )}

            <div className="flex items-center gap-1 rounded border border-[#1E293B] bg-[#0B0F17] p-0.5">
              {(
                [
                  { id: 'all', label: 'All Bias' },
                  { id: 'bullish_dominant', label: 'Bullish Dominant' },
                  { id: 'bearish_dominant', label: 'Bearish Dominant' },
                ] as { id: IntradaySlotFilterState['directionBiasFilter']; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    onChangeIntradayFilters({
                      ...intradayFilters,
                      directionBiasFilter: tab.id,
                    });
                    setMatrixPage(1);
                  }}
                  className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    intradayFilters.directionBiasFilter === tab.id
                      ? 'bg-[#1E293B] text-amber-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="intraday-min-rate" className="text-slate-400">
                Rate Floor:
              </label>
              <input
                id="intraday-min-rate"
                type="number"
                min={0}
                max={100}
                value={intradayFilters.minRateOverride}
                onChange={(e) => {
                  onChangeIntradayFilters({
                    ...intradayFilters,
                    minRateOverride: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  });
                  setMatrixPage(1);
                }}
                className="h-9 w-16 rounded border border-[#2A3950] bg-[#0B0F17] px-2 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
              <span className="font-mono text-slate-500">%</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-xs tabular-nums text-slate-400">
              {isSingleAnchor
                ? `Showing ${filteredIntradayMatches.length} of ${intradayResult.matches.length}`
                : `Showing ${displayedMatrixRows.length} of ${intradayResult.matrixSummaries.length}`}
            </span>
            <button
              type="button"
              onClick={handleResetIntradayFilters}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-amber-400"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>
        </section>

        {/* SINGLE-ANCHOR RANKED TABLE */}
        {isSingleAnchor ? (
          <section aria-label="Ranked intraday slot matches table" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-100">
                Ranked Intraday Time-Slot Matches
              </h2>
              <p className="text-xs text-slate-400">
                Click any row to inspect every exact UTC calendar day (YYYY-MM-DD), OHLC values,
                and side-by-side anchor vs. target candlesticks.
              </p>
            </div>

            <div className="overflow-hidden rounded border border-[#1E293B] bg-[#111824]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleIntradaySort('rank')}
                          className="inline-flex items-center gap-1 hover:text-slate-100"
                        >
                          <span>Rank</span>
                          {renderIntradaySortIcon('rank')}
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleIntradaySort('targetTimeframe')}
                          className="inline-flex items-center gap-1 hover:text-slate-100"
                        >
                          <span>Target TF</span>
                          {renderIntradaySortIcon('targetTimeframe')}
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleIntradaySort('targetSlot')}
                          className="inline-flex items-center gap-1 hover:text-slate-100"
                        >
                          <span>Target Slot (UTC)</span>
                          {renderIntradaySortIcon('targetSlot')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button
                          type="button"
                          onClick={() => handleIntradaySort('matchedDays')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                        >
                          <span>Matched / Total Days</span>
                          {renderIntradaySortIcon('matchedDays')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button
                          type="button"
                          onClick={() => handleIntradaySort('matchRatePct')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                        >
                          <span>Match Rate (%)</span>
                          {renderIntradaySortIcon('matchRatePct')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button
                          type="button"
                          onClick={() => handleIntradaySort('bullishMatches')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                        >
                          <span>Bullish Matches</span>
                          {renderIntradaySortIcon('bullishMatches')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button
                          type="button"
                          onClick={() => handleIntradaySort('bearishMatches')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                        >
                          <span>Bearish Matches</span>
                          {renderIntradaySortIcon('bearishMatches')}
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">Directional Split</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E293B]">
                    {displayedIntradayMatches.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-12 text-center">
                          <p className="text-sm font-medium text-slate-300">
                            No intraday target slots met the active match rate threshold
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {intradayResult.matches.length === 0
                              ? 'Lower Min Match Rate % or Min Co-Occurring Days in Step 3.'
                              : 'Reset local search or rate floor filters.'}
                          </p>
                          <div className="mt-4 flex flex-wrap justify-center gap-2">
                            {intradayResult.matches.length > 0 && (
                              <button
                                type="button"
                                onClick={handleResetIntradayFilters}
                                className="inline-flex h-9 items-center gap-1.5 rounded border border-[#2A3950] bg-[#0B0F17] px-3.5 text-xs font-medium text-amber-400 hover:border-amber-500/60"
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Reset Table Filters</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={onBackToConfigure}
                              className="inline-flex h-9 items-center gap-1.5 rounded border border-[#2A3950] bg-[#0B0F17] px-3.5 text-xs font-medium text-slate-200 hover:border-slate-500"
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Modify Search in Step 3</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      displayedIntradayMatches.map(({ match: m, rank }) => {
                        const isHigh = m.matchRatePct >= 80;
                        const bullShare =
                          m.matchedDays > 0 ? (m.bullishMatches / m.matchedDays) * 100 : 0;
                        const bearShare =
                          m.matchedDays > 0 ? (m.bearishMatches / m.matchedDays) * 100 : 0;

                        return (
                          <tr
                            key={m.id}
                            onClick={() => setSelectedIntradayMatch(m)}
                            className={`cursor-pointer transition-colors ${
                              isHigh
                                ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.09]'
                                : 'hover:bg-[#162032]'
                            }`}
                          >
                            <td className="px-4 py-3 font-mono tabular-nums text-slate-400">
                              #{rank}
                            </td>
                            <td className="px-4 py-3 font-mono font-medium text-slate-300">
                              {m.targetTimeframe}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedIntradayMatch(m);
                                }}
                                className="font-mono font-semibold text-slate-100 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                              >
                                {m.targetSlotKey} UTC
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                              <span className="font-semibold">{m.matchedDays}</span>
                              <span className="text-slate-500"> / {m.totalCoOccurringDays}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums">
                              <div className="flex flex-col items-end gap-1">
                                <span
                                  className={`font-semibold ${
                                    isHigh
                                      ? 'text-emerald-400'
                                      : m.matchRatePct >= 65
                                        ? 'text-sky-300'
                                        : 'text-amber-300'
                                  }`}
                                >
                                  {m.matchRatePct.toFixed(2)}%
                                </span>
                                <div className="h-1 w-20 overflow-hidden rounded bg-[#0B0F17]">
                                  <div
                                    className={
                                      isHigh
                                        ? 'h-full bg-emerald-500'
                                        : m.matchRatePct >= 65
                                          ? 'h-full bg-sky-400'
                                          : 'h-full bg-amber-400'
                                    }
                                    style={{ width: `${Math.min(100, m.matchRatePct)}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-400">
                              {m.bullishMatches.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-red-400">
                              {m.bearishMatches.toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className="flex h-2 w-24 overflow-hidden rounded-[2px] bg-[#0B0F17]"
                                  title={`Bullish: ${m.bullishMatches} · Bearish: ${m.bearishMatches}`}
                                >
                                  <div
                                    className="h-full bg-emerald-500"
                                    style={{ width: `${bullShare}%` }}
                                  />
                                  <div
                                    className="h-full bg-red-500"
                                    style={{ width: `${bearShare}%` }}
                                  />
                                </div>
                                <span className="font-mono text-[11px] tabular-nums text-slate-400">
                                  {bullShare.toFixed(0)}B / {bearShare.toFixed(0)}S
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : (
          /* FULL-MATRIX MASTER INTRADAY SLOT LEADERBOARD TABLE */
          <section aria-label="Master intraday slot matrix table" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Master Intraday Slot Matrix Leaderboard
                </h2>
                <p className="text-xs text-slate-400">
                  Every anchor slot in {intradayResult.anchorTimeframe} paired with its #1 highest
                  matching target slot. Click any row to inspect its Top 10 correlated slots and
                  full day-by-day history.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-slate-400">
                <label className="inline-flex items-center gap-1.5">
                  <span>Rows/page:</span>
                  <select
                    aria-label="Matrix rows per page"
                    value={matrixPageSize}
                    onChange={(e) => {
                      setMatrixPageSize(Number(e.target.value));
                      setMatrixPage(1);
                    }}
                    className="h-8 rounded border border-[#2A3950] bg-[#111824] px-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                  </select>
                </label>

                {totalMatrixPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={safeMatrixPage <= 1}
                      onClick={() => setMatrixPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous matrix page"
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <span className="px-1">
                      {safeMatrixPage} / {totalMatrixPages}
                    </span>
                    <button
                      type="button"
                      disabled={safeMatrixPage >= totalMatrixPages}
                      onClick={() => setMatrixPage((p) => Math.min(totalMatrixPages, p + 1))}
                      aria-label="Next matrix page"
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
                    >
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded border border-[#1E293B] bg-[#111824]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleMatrixSort('anchorSlot')}
                          className="inline-flex items-center gap-1 hover:text-slate-100"
                        >
                          <span>Anchor Slot (UTC)</span>
                          {renderMatrixSortIcon('anchorSlot')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button
                          type="button"
                          onClick={() => handleMatrixSort('validDays')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                        >
                          <span>Valid Anchor Days</span>
                          {renderMatrixSortIcon('validDays')}
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleMatrixSort('bestTarget')}
                          className="inline-flex items-center gap-1 hover:text-slate-100"
                        >
                          <span>#1 Best Matched Target</span>
                          {renderMatrixSortIcon('bestTarget')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button
                          type="button"
                          onClick={() => handleMatrixSort('matchedDays')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                        >
                          <span>Matched / Total</span>
                          {renderMatrixSortIcon('matchedDays')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button
                          type="button"
                          onClick={() => handleMatrixSort('matchRatePct')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                        >
                          <span>Match Rate (%)</span>
                          {renderMatrixSortIcon('matchRatePct')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <button
                          type="button"
                          onClick={() => handleMatrixSort('top5Avg')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                        >
                          <span>Top-5 Avg %</span>
                          {renderMatrixSortIcon('top5Avg')}
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">Best Pair Bull / Bear</th>
                      <th className="px-4 py-3 font-medium">Top 3 Correlated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E293B]">
                    {pageMatrixRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-12 text-center">
                          <p className="text-sm font-medium text-slate-300">
                            No anchor slots matched your current filter settings
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Reset dashboard filters or adjust Step 3 thresholds.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      pageMatrixRows.map((row) => {
                        const best = row.bestTarget;
                        const isHigh = Boolean(best && best.matchRatePct >= 80);

                        return (
                          <tr
                            key={row.id}
                            onClick={() => setSelectedMatrixRow(row)}
                            className={`cursor-pointer transition-colors ${
                              isHigh
                                ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.09]'
                                : 'hover:bg-[#162032]'
                            }`}
                          >
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedMatrixRow(row);
                                }}
                                className="font-mono font-semibold text-slate-100 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                              >
                                {row.anchorTimeframe} · {row.anchorSlotKey} UTC
                              </button>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums text-slate-300">
                              <span className="font-medium text-slate-100">
                                {row.totalValidAnchorDays.toLocaleString()}
                              </span>
                              <span className="ml-1.5 text-[11px] text-slate-500">
                                ({row.bullishAnchorDays}B / {row.bearishAnchorDays}S)
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 font-mono font-medium text-amber-300">
                              {best
                                ? `${best.targetTimeframe} · ${best.targetSlotKey} UTC`
                                : 'No qualifying target'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums text-slate-200">
                              {best ? (
                                <>
                                  <span className="font-semibold">{best.matchedDays}</span>
                                  <span className="text-slate-500">
                                    {' '}
                                    / {best.totalCoOccurringDays}
                                  </span>
                                </>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                              {best ? (
                                <div className="flex flex-col items-end gap-1">
                                  <span
                                    className={`font-semibold ${
                                      isHigh
                                        ? 'text-emerald-400'
                                        : best.matchRatePct >= 65
                                          ? 'text-sky-300'
                                          : 'text-amber-300'
                                    }`}
                                  >
                                    {best.matchRatePct.toFixed(2)}%
                                  </span>
                                  <div className="h-1 w-16 overflow-hidden rounded bg-[#0B0F17]">
                                    <div
                                      className={
                                        isHigh
                                          ? 'h-full bg-emerald-500'
                                          : best.matchRatePct >= 65
                                            ? 'h-full bg-sky-400'
                                            : 'h-full bg-amber-400'
                                      }
                                      style={{ width: `${Math.min(100, best.matchRatePct)}%` }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-500">0.00%</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums text-sky-300">
                              {row.topTargets.length > 0
                                ? `${row.top5AvgMatchRatePct.toFixed(1)}%`
                                : '—'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums">
                              {best ? (
                                <>
                                  <span className="text-emerald-400">{best.bullishMatches}B</span>
                                  <span className="mx-1 text-slate-600">/</span>
                                  <span className="text-red-400">{best.bearishMatches}S</span>
                                </>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">
                              {row.topTargets.length > 0
                                ? row.topTargets
                                    .slice(0, 3)
                                    .map(
                                      (t) =>
                                        `${t.targetTimeframe} ${t.targetSlotKey} (${t.matchRatePct.toFixed(0)}%)`
                                    )
                                    .join(' · ')
                                : '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Intraday Slot Day-by-Day Drill-Down Drawer */}
        <DrillDownDrawer
          intradayMatch={selectedIntradayMatch}
          intradayMatrixRow={selectedMatrixRow}
          intradayConfig={intradayResult.config}
          datasets={datasets}
          onClose={() => {
            setSelectedIntradayMatch(null);
            setSelectedMatrixRow(null);
          }}
        />
      </div>
    );
  }

  // =========================================================================
  // VIEW 1B: BEST MATCHED CANDLES DASHBOARD (GEOMETRIC / MULTI-TF)
  // =========================================================================
  if (engineMode === 'best_matches' && bestMatchResult) {
    const topMatch = filteredMatches[0] ?? null;
    const isSingle = bestMatchResult.scope === 'single_file';
    const hasVolCol =
      isSingle && bestMatchResult.config.includeVolumeWeight;

    const handleMatchSort = (key: MatchSortKey) => {
      if (matchSortKey === key) {
        setMatchSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setMatchSortKey(key);
        setMatchSortDir(key === 'rank' ? 'asc' : 'desc');
      }
    };

    const renderMatchSortIcon = (key: MatchSortKey) => {
      if (matchSortKey !== key) {
        return <ArrowUpDown className="h-3 w-3 text-slate-600" aria-hidden="true" />;
      }
      return matchSortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3 text-amber-400" aria-hidden="true" />
      ) : (
        <ArrowDown className="h-3 w-3 text-amber-400" aria-hidden="true" />
      );
    };

    const handleResetMatchFilters = () => {
      onChangeBestMatchFilters({
        searchQuery: '',
        directionFilter: 'all',
        minScoreOverride: 0,
      });
    };

    return (
      <div className="space-y-6">
        {/* Header & Exports */}
        <div className="flex flex-col justify-between gap-4 border-b border-[#1E293B] pb-6 lg:flex-row lg:items-end">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-amber-400">
              Step 4 of 4 · Best Matched Candles Search Dashboard
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
              Best Matched Candles Rankings
            </h1>
            <p className="text-xs text-slate-400">
              <span>
                {isSingle
                  ? `Single-File (${bestMatchResult.config.singleTimeframe} · ${
                      bestMatchResult.config.singleSubMode === 'reference'
                        ? `Reference K=${bestMatchResult.config.sequenceLength}`
                        : `Auto-Scan K=${bestMatchResult.config.sequenceLength}`
                    })`
                  : `Cross-Timeframe (${bestMatchResult.activeTimeframes.join(' + ')})`}
              </span>
              <span aria-hidden="true" className="mx-2 text-slate-600">·</span>
              <span className="font-mono tabular-nums">
                Computed in {bestMatchResult.computeDurationMs.toFixed(1)} ms
              </span>
              {bestMatchResult.usedWorker && (
                <>
                  <span aria-hidden="true" className="mx-2 text-slate-600">·</span>
                  <span>Off-Thread Worker</span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onBackToConfigure}
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#1E293B] bg-[#111824] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-[#162032]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <span>Modify Search</span>
            </button>

            <button
              type="button"
              onClick={() => downloadBestMatchesCsv(bestMatchResult, filteredMatches)}
              disabled={filteredMatches.length === 0}
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#2A3950] bg-[#111824] px-3.5 text-xs font-medium text-slate-100 transition-colors hover:border-amber-500/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export Matches CSV</span>
            </button>

            <button
              type="button"
              onClick={() =>
                exportBestMatchesReportPdf(bestMatchResult, filteredMatches, bestMatchFilters)
              }
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded bg-amber-500 px-4 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download PDF Report</span>
            </button>
          </div>
        </div>

        {/* Warning Banner */}
        {bestMatchResult.warningMessage && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <p className="leading-relaxed">{bestMatchResult.warningMessage}</p>
          </div>
        )}

        {/* Reference Candle Banner when Mode B Reference ran */}
        {bestMatchResult.referenceSnapshots && bestMatchResult.referenceSnapshots.length > 0 && (
          <section
            aria-label="Active reference pattern"
            className="flex flex-wrap items-center justify-between gap-4 rounded border border-[#1E293B] bg-[#111824] px-5 py-3.5"
          >
            <div className="space-y-0.5">
              <p className="text-[11px] font-medium text-amber-400">
                Reference Target Sequence ({bestMatchResult.config.singleTimeframe} · K=
                {bestMatchResult.referenceSnapshots.length})
              </p>
              <p className="font-mono text-xs text-slate-200">
                {bestMatchResult.referenceSnapshots
                  .map(
                    (s) =>
                      `${s.candle.timeStr} (${s.candle.candleType}, Body ${(s.features.bodyRatio * 100).toFixed(0)}%)`
                  )
                  .join(' → ')}
              </p>
            </div>
            <SnapshotStripGlyphs
              snapshots={bestMatchResult.referenceSnapshots}
              sharedScale={true}
            />
          </section>
        )}

        {/* 6 KPI Summary Strip */}
        <section
          aria-label="Best matched candles summary KPIs"
          className="grid grid-cols-2 divide-y divide-[#1E293B] rounded border border-[#1E293B] bg-[#111824] md:grid-cols-3 lg:grid-cols-6 lg:divide-x lg:divide-y-0"
        >
          <div className="p-4">
            <p className="text-[11px] text-slate-400">Search Mode</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-100">
              {isSingle ? 'Single-File Pattern' : 'Cross-Timeframe'}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
              {isSingle
                ? bestMatchResult.config.singleSubMode === 'reference'
                  ? `Reference K=${bestMatchResult.config.sequenceLength}`
                  : `Auto-Scan K=${bestMatchResult.config.sequenceLength}`
                : bestMatchResult.config.multiTfAnchor === 'parent_window'
                  ? 'Parent Window Anchor'
                  : 'Lowest TF Anchor'}
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">Active Timeframes</p>
            <p className="mt-1 truncate font-mono text-sm font-semibold text-slate-100">
              {bestMatchResult.activeTimeframes.join(' · ') || '—'}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              {bestMatchResult.activeTimeframes.length} timeframe
              {bestMatchResult.activeTimeframes.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">Top Match Score</p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-emerald-400">
              {topMatch ? `${topMatch.matchScore.toFixed(2)}%` : '—'}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
              {topMatch ? topMatch.timeStr : 'No qualifying match'}
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">Qualifying Matches</p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-100">
              {bestMatchResult.totalAboveThreshold.toLocaleString()}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              of {bestMatchResult.totalCandidatesScanned.toLocaleString()} scanned (≥
              {bestMatchResult.config.minMatchScore}%)
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">Avg Structure Sim.</p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-sky-300">
              {filteredMatches.length > 0 ? `${avgStructuralSim.toFixed(1)}%` : '—'}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Showing Top {filteredMatches.length}
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">Effective UTC Range</p>
            <p className="mt-1 font-mono text-xs font-semibold tabular-nums text-slate-100">
              {bestMatchResult.effectiveStartUtc ?? '—'}
            </p>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-400">
              → {bestMatchResult.effectiveEndUtc ?? '—'}
            </p>
          </div>
        </section>

        {/* Interactive Filter Toolbar */}
        <section
          aria-label="Best matched candles filters"
          className="flex flex-wrap items-center justify-between gap-4 rounded border border-[#1E293B] bg-[#111824] p-4"
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative w-64">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                type="text"
                value={bestMatchFilters.searchQuery}
                onChange={(e) =>
                  onChangeBestMatchFilters({
                    ...bestMatchFilters,
                    searchQuery: e.target.value,
                  })
                }
                placeholder="Search UTC date, pattern, TF..."
                aria-label="Search matched candles"
                className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1 rounded border border-[#1E293B] bg-[#0B0F17] p-0.5">
              {(
                [
                  { id: 'all', label: 'All Polarity' },
                  { id: 'bullish', label: 'Bullish' },
                  { id: 'bearish', label: 'Bearish' },
                  { id: 'doji', label: 'Doji' },
                ] as { id: BestMatchFilterState['directionFilter']; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    onChangeBestMatchFilters({ ...bestMatchFilters, directionFilter: tab.id })
                  }
                  className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    bestMatchFilters.directionFilter === tab.id
                      ? 'bg-[#1E293B] text-amber-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="res-min-match-filter" className="text-slate-400">
                Floor:
              </label>
              <input
                id="res-min-match-filter"
                type="number"
                min={0}
                max={100}
                value={bestMatchFilters.minScoreOverride}
                onChange={(e) =>
                  onChangeBestMatchFilters({
                    ...bestMatchFilters,
                    minScoreOverride: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  })
                }
                className="h-9 w-16 rounded border border-[#2A3950] bg-[#0B0F17] px-2 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
              <span className="font-mono text-slate-500">%</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-xs tabular-nums text-slate-400">
              Showing {filteredMatches.length} of {bestMatchResult.matches.length} returned
            </span>
            <button
              type="button"
              onClick={handleResetMatchFilters}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-amber-400"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>
        </section>

        {/* Best Matched Candles Ranked Table */}
        <section aria-label="Best Matched Candles table" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-100">
              Best Matched Candles
            </h2>
            <p className="text-xs text-slate-400">
              Click any row to inspect full OHLCV data, wick/body percentages, and SVG candlestick
              geometry comparison.
            </p>
          </div>

          <div className="overflow-hidden rounded border border-[#1E293B] bg-[#111824]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
                    <th className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        onClick={() => handleMatchSort('rank')}
                        className="inline-flex items-center gap-1 hover:text-slate-100"
                      >
                        <span>Rank</span>
                        {renderMatchSortIcon('rank')}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        onClick={() => handleMatchSort('timestamp')}
                        className="inline-flex items-center gap-1 hover:text-slate-100"
                      >
                        <span>Start Time (UTC)</span>
                        {renderMatchSortIcon('timestamp')}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-medium">Candlesticks</th>
                    <th className="px-4 py-3 font-medium">Pattern / Setup</th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleMatchSort('matchScore')}
                        className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                      >
                        <span>Match Score</span>
                        {renderMatchSortIcon('matchScore')}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        onClick={() => handleMatchSort('dominantDirection')}
                        className="inline-flex items-center gap-1 hover:text-slate-100"
                      >
                        <span>Polarity</span>
                        {renderMatchSortIcon('dominantDirection')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleMatchSort('directionalScore')}
                        className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                      >
                        <span>Dir. Align</span>
                        {renderMatchSortIcon('directionalScore')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleMatchSort('structuralScore')}
                        className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                      >
                        <span>Struct. Sim</span>
                        {renderMatchSortIcon('structuralScore')}
                      </button>
                    </th>
                    {hasVolCol && (
                      <th className="px-4 py-3 text-right font-medium">
                        <button
                          type="button"
                          onClick={() => handleMatchSort('volumeScore')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                        >
                          <span>Vol Sim</span>
                          {renderMatchSortIcon('volumeScore')}
                        </button>
                      </th>
                    )}
                    <th className="px-4 py-3 font-medium">Breakdown</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B]">
                  {displayedMatches.length === 0 ? (
                    <tr>
                      <td colSpan={hasVolCol ? 10 : 9} className="px-6 py-12 text-center">
                        <p className="text-sm font-medium text-slate-300">
                          No matched candles meet the active threshold
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {bestMatchResult.matches.length === 0
                            ? 'Return to Step 3 to lower the Min Match Score slider or broaden your UTC date range.'
                            : 'Clear your local search or lower the dashboard score floor.'}
                        </p>
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                          {bestMatchResult.matches.length > 0 && (
                            <button
                              type="button"
                              onClick={handleResetMatchFilters}
                              className="inline-flex h-9 items-center gap-1.5 rounded border border-[#2A3950] bg-[#0B0F17] px-3.5 text-xs font-medium text-amber-400 hover:border-amber-500/60"
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Reset Table Filters</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={onBackToConfigure}
                            className="inline-flex h-9 items-center gap-1.5 rounded border border-[#2A3950] bg-[#0B0F17] px-3.5 text-xs font-medium text-slate-200 hover:border-slate-500"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Adjust Threshold in Step 3</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    displayedMatches.map(({ match: m, rank }) => {
                      const isElite = m.matchScore >= 90;
                      const rowBg = isElite
                        ? 'bg-emerald-500/[0.05] hover:bg-emerald-500/[0.1]'
                        : 'hover:bg-[#162032]';

                      return (
                        <tr
                          key={m.id}
                          onClick={() => setSelectedMatch(m)}
                          className={`cursor-pointer transition-colors ${rowBg}`}
                        >
                          <td className="px-4 py-3 font-mono tabular-nums text-slate-400">
                            #{rank}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedMatch(m);
                              }}
                              className="text-left font-mono font-semibold text-slate-100 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                            >
                              {m.timeStr}
                            </button>
                            <span className="block font-mono text-[10px] text-slate-500">
                              Anchor: {m.anchorTimeframe}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <SnapshotStripGlyphs
                              snapshots={m.snapshots}
                              sharedScale={isSingle}
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-200">
                            {m.patternLabel}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={`font-semibold ${
                                  isElite
                                    ? 'text-emerald-400'
                                    : m.matchScore >= 80
                                      ? 'text-sky-300'
                                      : 'text-amber-300'
                                }`}
                              >
                                {m.matchScore.toFixed(2)}%
                              </span>
                              <div className="h-1 w-16 overflow-hidden rounded bg-[#0B0F17]">
                                <div
                                  className={
                                    isElite
                                      ? 'h-full bg-emerald-500'
                                      : m.matchScore >= 80
                                        ? 'h-full bg-sky-400'
                                        : 'h-full bg-amber-400'
                                  }
                                  style={{ width: `${Math.min(100, m.matchScore)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {renderDirectionLabel(m.dominantDirection)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                            {m.directionalScore.toFixed(1)}%
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-sky-300">
                            {m.structuralScore.toFixed(1)}%
                          </td>
                          {hasVolCol && (
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-300">
                              {m.volumeScore !== null ? `${m.volumeScore.toFixed(1)}%` : '—'}
                            </td>
                          )}
                          <td className="px-4 py-3 text-slate-400">
                            <span>{m.summaryDetail}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Match Inspection Drawer */}
        <DrillDownDrawer
          bestMatch={selectedMatch}
          referenceSnapshots={bestMatchResult.referenceSnapshots}
          bestMatchScope={bestMatchResult.scope}
          onClose={() => setSelectedMatch(null)}
        />
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: PRINCIPAL VS TARGET CORRELATION DASHBOARD (EXISTING)
  // =========================================================================
  if (!result) return null;

  const topCandidate = rankedCandidates[0] ?? null;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(
        key === 'rank' || key === 'slotLabel' || key === 'timingRelation' ? 'asc' : 'desc'
      );
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3 w-3 text-slate-600" aria-hidden="true" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-amber-400" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3 w-3 text-amber-400" aria-hidden="true" />
    );
  };

  const handleResetFilters = () => {
    onChangeFilters({
      searchQuery: '',
      minAlignmentPct: 0,
      minSampleSize: 1,
      directionFilter: 'both',
      beforeCloseOnly: false,
      startDateUtc: '',
      endDateUtc: '',
    });
    if (result.config.startDateUtc || result.config.endDateUtc) {
      onDateRangeChange('', '');
    }
  };

  const handleExportPdf = () => {
    exportCorrelationReportPdf(result, rankedCandidates, filters, datasets);
  };

  const handleExportCsv = () => {
    downloadCorrelationResultsCsv(result, rankedCandidates);
  };

  return (
    <div className="space-y-6">
      {/* Header & Exports */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#1E293B] pb-6 lg:flex-row lg:items-end">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-amber-400">
            Step 4 of 4 · Correlation Results Dashboard
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
            Principal Candle Alignment Rankings
          </h1>
          <p className="text-xs text-slate-400">
            <span>{result.targetDescription}</span>
            <span aria-hidden="true" className="mx-2 text-slate-600">·</span>
            <span>{result.searchDescription}</span>
            <span aria-hidden="true" className="mx-2 text-slate-600">·</span>
            <span className="font-mono tabular-nums">
              Computed in {result.computeDurationMs.toFixed(1)} ms
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onBackToConfigure}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#1E293B] bg-[#111824] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-[#162032]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span>Modify Target</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={rankedCandidates.length === 0}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#2A3950] bg-[#111824] px-3.5 text-xs font-medium text-slate-100 transition-colors hover:border-amber-500/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export Results as CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded bg-amber-500 px-4 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Download as PDF</span>
          </button>
        </div>
      </div>

      {/* Warning Banner */}
      {result.warningMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="leading-relaxed">{result.warningMessage}</p>
        </div>
      )}

      {/* 6 KPI Summary Cards */}
      <section
        aria-label="Correlation summary KPIs"
        className="grid grid-cols-2 divide-y divide-[#1E293B] rounded border border-[#1E293B] bg-[#111824] md:grid-cols-3 lg:grid-cols-6 lg:divide-x lg:divide-y-0"
      >
        <div className="p-4">
          <p className="text-[11px] text-slate-400">Target Candle</p>
          <p className="mt-1 truncate font-mono text-sm font-semibold text-slate-100" title={result.targetDescription}>
            {result.targetDescription}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {result.config.mode === 'cross' ? 'Cross-Timeframe' : 'Same-Timeframe'}
          </p>
        </div>

        <div className="p-4">
          <p className="text-[11px] text-slate-400">Search Timeframe</p>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-100">
            {result.config.mode === 'same'
              ? result.config.targetTimeframe
              : result.config.searchTimeframe}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500" title={result.searchDescription}>
            {result.candidates.length} candidate slots
          </p>
        </div>

        <div className="p-4">
          <p className="text-[11px] text-slate-400">
            Top Principal{' '}
            {filters.directionFilter === 'bullish'
              ? '(Bullish)'
              : filters.directionFilter === 'bearish'
                ? '(Bearish)'
                : 'Candle'}
          </p>
          <p className="mt-1 truncate font-mono text-sm font-semibold text-emerald-400">
            {topCandidate
              ? `${topCandidate.slotLabel} · ${(getDirectionScore(topCandidate, filters.directionFilter) ?? 0).toFixed(1)}%`
              : '—'}
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
            {topCandidate
              ? `N=${topCandidate.totalValidPairs} · ${topCandidate.timingRelation}`
              : 'No matches'}
          </p>
        </div>

        <div className="p-4">
          <p className="text-[11px] text-slate-400">Valid Cycles Analyzed</p>
          <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-100">
            {result.totalValidCycles.toLocaleString()}
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
            of {result.totalCyclesScanned.toLocaleString()} scanned
          </p>
        </div>

        <div className="p-4">
          <p className="text-[11px] text-slate-400">Excluded Dojis</p>
          <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-amber-400">
            {result.totalExcludedDojiPairs.toLocaleString()}{' '}
            {result.totalExcludedDojiPairs === 1 ? 'pair' : 'pairs'}
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
            {result.totalExcludedTargetDojis.toLocaleString()}{' '}
            {result.totalExcludedTargetDojis === 1 ? 'target Doji' : 'target Dojis'}
          </p>
        </div>

        <div className="p-4">
          <p className="text-[11px] text-slate-400">Overlapping UTC Range</p>
          <p className="mt-1 font-mono text-xs font-semibold tabular-nums text-slate-100">
            {result.effectiveStartUtc ?? '—'}
          </p>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-400">
            → {result.effectiveEndUtc ?? '—'}
          </p>
        </div>
      </section>

      {/* Interactive Filter & Guardrails Toolbar */}
      <section
        aria-label="Correlation filters"
        className="space-y-4 rounded border border-[#1E293B] bg-[#111824] p-4"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-3">
            <label htmlFor="filter-slot-search" className="mb-1 block text-[11px] font-medium text-slate-400">
              Search Slot
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                id="filter-slot-search"
                type="text"
                value={filters.searchQuery}
                onChange={(e) =>
                  onChangeFilters({ ...filters, searchQuery: e.target.value })
                }
                placeholder="e.g. 14:00, Mon, Target - 2"
                className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="lg:col-span-2">
            <label htmlFor="res-start-date" className="mb-1 block text-[11px] font-medium text-slate-400">
              Start UTC Date
            </label>
            <input
              id="res-start-date"
              type="date"
              value={result.config.startDateUtc}
              min={result.overlapStartUtc ?? undefined}
              max={result.overlapEndUtc ?? undefined}
              onChange={(e) => onDateRangeChange(e.target.value, result.config.endDateUtc)}
              className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-2.5 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="lg:col-span-2">
            <label htmlFor="res-end-date" className="mb-1 block text-[11px] font-medium text-slate-400">
              End UTC Date
            </label>
            <input
              id="res-end-date"
              type="date"
              value={result.config.endDateUtc}
              min={result.overlapStartUtc ?? undefined}
              max={result.overlapEndUtc ?? undefined}
              onChange={(e) => onDateRangeChange(result.config.startDateUtc, e.target.value)}
              className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-2.5 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2 lg:col-span-4">
            <label htmlFor="filter-min-align" className="mb-1 block text-[11px] font-medium text-slate-400">
              Min Alignment %
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                id="filter-min-align"
                type="number"
                min={0}
                max={100}
                step={5}
                value={filters.minAlignmentPct}
                onChange={(e) =>
                  onChangeFilters({
                    ...filters,
                    minAlignmentPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  })
                }
                className="h-9 w-16 shrink-0 rounded border border-[#2A3950] bg-[#0B0F17] px-2 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-1">
                {[0, 80, 90, 100].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() =>
                      onChangeFilters({ ...filters, minAlignmentPct: preset })
                    }
                    className={`h-9 whitespace-nowrap rounded border px-2.5 font-mono text-[11px] font-medium transition-colors ${
                      filters.minAlignmentPct === preset
                        ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                        : 'border-[#1E293B] bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {preset === 0 ? 'All' : preset === 100 ? '100%' : `≥${preset}%`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <label htmlFor="filter-min-n" className="mb-1 block whitespace-nowrap text-[11px] font-medium text-slate-400">
              Min N
            </label>
            <input
              id="filter-min-n"
              type="number"
              min={1}
              value={filters.minSampleSize}
              onChange={(e) =>
                onChangeFilters({
                  ...filters,
                  minSampleSize: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-2.5 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1E293B] pt-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Direction:</span>
              <div className="flex items-center gap-1 rounded border border-[#1E293B] bg-[#0B0F17] p-0.5">
                {(
                  [
                    { id: 'both', label: 'Both Bullish & Bearish' },
                    { id: 'bullish', label: 'Bullish Only' },
                    { id: 'bearish', label: 'Bearish Only' },
                  ] as { id: DirectionFilter; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      onChangeFilters({ ...filters, directionFilter: opt.id })
                    }
                    className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      filters.directionFilter === opt.id
                        ? 'bg-[#1E293B] text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={filters.beforeCloseOnly}
                onChange={(e) =>
                  onChangeFilters({ ...filters, beforeCloseOnly: e.target.checked })
                }
                className="h-4 w-4 rounded border-[#2A3950] bg-[#0B0F17] accent-amber-500"
              />
              <span>Closes before Target closes only (Leading signals)</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-xs tabular-nums text-slate-400">
              Showing {rankedCandidates.length} of {result.candidates.length} slots
            </span>
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-amber-400"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset Filters</span>
            </button>
          </div>
        </div>
      </section>

      {/* Top 15 Horizontal Bar Chart */}
      <TopBarChart
        candidates={rankedCandidates}
        directionFilter={filters.directionFilter}
        onSelectCandidate={setSelectedCandidate}
      />

      {/* Ranked Principal Candles Table */}
      <section aria-label="Ranked Principal Candles table" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-100">
            Ranked Principal Candles
          </h2>
          <p className="text-xs text-slate-400">
            Click any row to open the date-by-date historical verification drawer.
          </p>
        </div>

        <div className="overflow-hidden rounded border border-[#1E293B] bg-[#111824]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
                  <th className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('rank')}
                      className="inline-flex items-center gap-1 hover:text-slate-100"
                    >
                      <span>Rank</span>
                      {renderSortIcon('rank')}
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('slotLabel')}
                      className="inline-flex items-center gap-1 hover:text-slate-100"
                    >
                      <span>Principal Candle Slot</span>
                      {renderSortIcon('slotLabel')}
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">TF</th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('overallAlignmentScore')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Overall Match %</span>
                      {renderSortIcon('overallAlignmentScore')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('bullishMatchRate')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Bullish Match %</span>
                      {renderSortIcon('bullishMatchRate')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('bearishMatchRate')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Bearish Match %</span>
                      {renderSortIcon('bearishMatchRate')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('totalValidPairs')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Sample N</span>
                      {renderSortIcon('totalValidPairs')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('excludedDojiPairs')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Excl. Dojis</span>
                      {renderSortIcon('excludedDojiPairs')}
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('timingRelation')}
                      className="inline-flex items-center gap-1 hover:text-slate-100"
                    >
                      <span>Timing Relation</span>
                      {renderSortIcon('timingRelation')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E293B]">
                {displayedRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center">
                      <p className="text-sm font-medium text-slate-300">
                        No Principal Candles matched your active filter thresholds
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Try lowering Min Alignment %, reducing Min Sample Size N, or clearing the
                        search query.
                      </p>
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="mt-4 inline-flex h-9 items-center gap-1.5 rounded border border-[#2A3950] bg-[#0B0F17] px-3.5 text-xs font-medium text-amber-400 hover:border-amber-500/60"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Reset All Filters</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  displayedRows.map(({ candidate: c, rank }) => {
                    const isPerfect = c.totalValidPairs > 0 && c.overallAlignmentScore >= 100;
                    const isHigh = !isPerfect && c.overallAlignmentScore >= 90;

                    const rowBg = isPerfect
                      ? 'bg-emerald-500/[0.06] hover:bg-emerald-500/[0.11]'
                      : isHigh
                        ? 'bg-sky-500/[0.04] hover:bg-sky-500/[0.09]'
                        : 'hover:bg-[#162032]';

                    return (
                      <tr
                        key={c.slotKey}
                        onClick={() => setSelectedCandidate(c)}
                        className={`cursor-pointer transition-colors ${rowBg}`}
                      >
                        <td className="px-4 py-3 font-mono tabular-nums text-slate-400">
                          #{rank}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCandidate(c);
                            }}
                            className="text-left font-mono font-semibold text-slate-100 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                          >
                            {c.slotLabel}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-400">
                          {c.searchTimeframe}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          <span
                            className={`font-semibold ${
                              isPerfect
                                ? 'text-emerald-400'
                                : isHigh
                                  ? 'text-sky-300'
                                  : c.overallAlignmentScore >= 80
                                    ? 'text-amber-300'
                                    : 'text-slate-200'
                            }`}
                          >
                            {c.overallAlignmentScore.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                          {c.bullishMatchRate !== null ? (
                            <>
                              <span>{c.bullishMatchRate.toFixed(1)}%</span>
                              <span className="ml-1.5 text-[11px] text-slate-500">
                                ({c.bullishMatches}/{c.targetBullishCount})
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-500">— (0/0)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                          {c.bearishMatchRate !== null ? (
                            <>
                              <span>{c.bearishMatchRate.toFixed(1)}%</span>
                              <span className="ml-1.5 text-[11px] text-slate-500">
                                ({c.bearishMatches}/{c.targetBearishCount})
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-500">— (0/0)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-medium tabular-nums text-slate-100">
                          {c.totalValidPairs.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-400/90">
                          {c.excludedDojiPairs.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {renderTimingTag(c.timingRelation, c.timingDetail)}
                            <span className="hidden text-[11px] text-slate-500 xl:inline">
                              {c.timingDetail}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Date-by-Date Verification Drill-Down Drawer */}
      <DrillDownDrawer
        candidate={selectedCandidate}
        targetDescription={result.targetDescription}
        onClose={() => setSelectedCandidate(null)}
      />
    </div>
  );
}
