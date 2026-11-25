import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { filterAndRankCandidates, getDirectionScore } from '../engine/correlation';
import { downloadCorrelationResultsCsv } from '../engine/csvExport';
import { exportCorrelationReportPdf } from '../engine/pdfExport';
import {
  AnalysisResult,
  DirectionFilter,
  PrincipalCandidateResult,
  ResultsFilterState,
  TimeframeDataset,
  TimeframeId,
  TimingRelation,
} from '../engine/types';
import { DrillDownDrawer } from './DrillDownDrawer';
import { TopBarChart } from './TopBarChart';

interface StepResultsProps {
  result: AnalysisResult;
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>;
  filters: ResultsFilterState;
  onChangeFilters: (next: ResultsFilterState) => void;
  onDateRangeChange: (startDateUtc: string, endDateUtc: string) => void;
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

export function StepResults({
  result,
  datasets,
  filters,
  onChangeFilters,
  onDateRangeChange,
  onBackToConfigure,
}: StepResultsProps) {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedCandidate, setSelectedCandidate] =
    useState<PrincipalCandidateResult | null>(null);

  const rankedCandidates = useMemo(
    () => filterAndRankCandidates(result.candidates, filters),
    [result.candidates, filters]
  );

  // Assign deterministic 1-based rank before any user column re-sort
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

      {/* Warning Banner (Non-overlapping dates / All Doji / Empty window) */}
      {result.warningMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="leading-relaxed">{result.warningMessage}</p>
        </div>
      )}

      {/* 6 KPI Summary Cards (Single Elevation Grid with Hairline Dividers) */}
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

      {/* Interactive Filter & Anti-False-Positive Guardrails Toolbar */}
      <section
        aria-label="Correlation filters"
        className="space-y-4 rounded border border-[#1E293B] bg-[#111824] p-4"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
          {/* Search Slot */}
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

          {/* Date Range Start */}
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

          {/* Date Range End */}
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

          {/* Min Alignment % */}
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

          {/* Min Sample Size N */}
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

        {/* Second Row: Direction Segmented Filter + Before-Close Toggle + Reset */}
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
