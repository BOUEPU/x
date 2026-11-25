import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Download,
  FileDown,
  Layers,
  RotateCcw,
  Search,
} from 'lucide-react';
import {
  collectCandleDataAsync,
  filterCollectedSlots,
} from '../engine/collector';
import { downloadCollectedSummaryCsv } from '../engine/csvExport';
import { formatDecimal } from '../engine/csvParser';
import { exportCollectedSummaryPdf } from '../engine/pdfExport';
import {
  CollectedCandleSlot,
  CollectorConfig,
  CollectorProgress,
  CollectorResult,
  TimeframeDataset,
  TimeframeId,
  TIMEFRAMES,
  TIMEFRAME_MAP,
} from '../engine/types';
import { SlotHistoryModal } from './SlotHistoryModal';

interface StepCollectorProps {
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>;
  config: CollectorConfig;
  result: CollectorResult | null;
  onChangeConfig: (next: CollectorConfig) => void;
  onResultReady: (res: CollectorResult) => void;
  onUseAsTargetCandle: (slot: CollectedCandleSlot) => void;
}

type SortKey =
  | 'slot'
  | 'totalOccurrences'
  | 'validNonDojiCount'
  | 'bullishPct'
  | 'bearishPct'
  | 'dojiCount'
  | 'dominancePct'
  | 'avgDiff'
  | 'avgRange'
  | 'avgVolume'
  | 'longestBullishStreak'
  | 'longestBearishStreak';

export function StepCollector({
  datasets,
  config,
  result,
  onChangeConfig,
  onResultReady,
  onUseAsTargetCandle,
}: StepCollectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('slot');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [isCollecting, setIsCollecting] = useState(false);
  const [progress, setProgress] = useState<CollectorProgress | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<CollectedCandleSlot | null>(null);

  const runIdRef = useRef(0);

  const loadedTimeframes = useMemo(
    () =>
      TIMEFRAMES.filter((t) => datasets[t.id] && datasets[t.id]!.candles.length > 0),
    [datasets]
  );

  // Determine which timeframe categories are active in the current scope
  const activeScopeTimeframes = useMemo(() => {
    if (config.scope === 'ALL') return loadedTimeframes;
    return loadedTimeframes.filter((t) => t.id === config.scope);
  }, [config.scope, loadedTimeframes]);

  const hasIntraday = activeScopeTimeframes.some((t) => t.isIntraday);
  const hasDaily = activeScopeTimeframes.some((t) => t.id === '1D');
  const hasWeekly = activeScopeTimeframes.some((t) => t.id === '1W');
  const hasMonthly = activeScopeTimeframes.some((t) => t.id === '1M');

  // Auto-run chunked async collection whenever scope, grouping, or UTC date bounds change
  const collectionSignature = JSON.stringify({
    scope: config.scope,
    grouping: config.grouping,
    startDateUtc: config.startDateUtc,
    endDateUtc: config.endDateUtc,
    loadedKey: loadedTimeframes
      .map((t) => `${t.id}:${datasets[t.id]?.rowCount}:${datasets[t.id]?.audit.verifiedAtUtc}`)
      .join('|'),
  });

  useEffect(() => {
    if (loadedTimeframes.length === 0) return;

    // Ensure scope points to a valid loaded timeframe if not ALL
    if (config.scope !== 'ALL' && !datasets[config.scope]) {
      onChangeConfig({ ...config, scope: loadedTimeframes[0].id });
      return;
    }

    const myRunId = ++runIdRef.current;
    setIsCollecting(true);

    void collectCandleDataAsync(
      datasets,
      config,
      (prog) => {
        if (runIdRef.current === myRunId) {
          setProgress(prog);
        }
      },
      () => runIdRef.current !== myRunId
    ).then((res) => {
      if (runIdRef.current !== myRunId) return;
      if (res) {
        onResultReady(res);
      }
      setIsCollecting(false);
      setProgress(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionSignature]);

  const filteredSlots = useMemo(() => {
    if (!result) return [];
    return filterCollectedSlots(result.slots, {
      excludeDojiFromPct: config.excludeDojiFromPct,
      minOccurrences: config.minOccurrences,
      searchQuery,
    });
  }, [result, config.excludeDojiFromPct, config.minOccurrences, searchQuery]);

  const sortedSlots = useMemo(() => {
    const arr = filteredSlots.slice();
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'slot': {
          const tfCmp =
            TIMEFRAME_MAP[a.timeframe].rankOrder - TIMEFRAME_MAP[b.timeframe].rankOrder;
          cmp = tfCmp !== 0 ? tfCmp : a.slotSortOrder - b.slotSortOrder;
          break;
        }
        case 'totalOccurrences':
          cmp = a.totalOccurrences - b.totalOccurrences;
          break;
        case 'validNonDojiCount':
          cmp = a.validNonDojiCount - b.validNonDojiCount;
          break;
        case 'bullishPct':
          cmp = a.bullishPct - b.bullishPct;
          break;
        case 'bearishPct':
          cmp = a.bearishPct - b.bearishPct;
          break;
        case 'dojiCount':
          cmp = a.dojiCount - b.dojiCount;
          break;
        case 'dominancePct':
          cmp = a.dominancePct - b.dominancePct;
          if (cmp === 0) cmp = a.validNonDojiCount - b.validNonDojiCount;
          break;
        case 'avgDiff':
          cmp = a.avgDiff - b.avgDiff;
          break;
        case 'avgRange':
          cmp = a.avgRange - b.avgRange;
          break;
        case 'avgVolume':
          cmp = a.avgVolume - b.avgVolume;
          break;
        case 'longestBullishStreak':
          cmp = a.longestBullishStreak - b.longestBullishStreak;
          break;
        case 'longestBearishStreak':
          cmp = a.longestBearishStreak - b.longestBearishStreak;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredSlots, sortKey, sortDir]);

  // Reset to page 1 when filter/search/scope changes
  useEffect(() => {
    setPage(1);
  }, [searchQuery, config.minOccurrences, config.scope, config.grouping, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedSlots.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageSlots = sortedSlots.slice((safePage - 1) * pageSize, safePage * pageSize);

  const summaryStats = useMemo(() => {
    let highBull = 0;
    let highBear = 0;
    let topSlot: CollectedCandleSlot | null = null;

    for (let i = 0; i < filteredSlots.length; i++) {
      const s = filteredSlots[i];
      if (s.validNonDojiCount === 0) continue;
      if (s.bullishPct >= 70) highBull++;
      if (s.bearishPct >= 70) highBear++;
      if (
        !topSlot ||
        s.dominancePct > topSlot.dominancePct ||
        (s.dominancePct === topSlot.dominancePct &&
          s.validNonDojiCount > topSlot.validNonDojiCount)
      ) {
        topSlot = s;
      }
    }

    return { highBull, highBear, topSlot };
  }, [filteredSlots]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'slot' ? 'asc' : 'desc');
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
    setSearchQuery('');
    onChangeConfig({
      ...config,
      startDateUtc: '',
      endDateUtc: '',
      excludeDojiFromPct: true,
      minOccurrences: 1,
    });
  };

  const handleExportCsv = () => {
    if (!result) return;
    downloadCollectedSummaryCsv(result, sortedSlots);
  };

  const handleExportPdf = () => {
    if (!result) return;
    exportCollectedSummaryPdf(result, sortedSlots, {
      excludeDojiFromPct: config.excludeDojiFromPct,
      minOccurrences: config.minOccurrences,
      searchQuery,
    });
  };

  // Sync selected modal slot if excludeDojiFromPct toggled while modal is open
  const activeModalSlot = useMemo(() => {
    if (!selectedSlot) return null;
    return filteredSlots.find((s) => s.id === selectedSlot.id) ?? selectedSlot;
  }, [selectedSlot, filteredSlots]);

  return (
    <div className="space-y-6">
      {/* Header & Exports */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#1E293B] pb-6 lg:flex-row lg:items-end">
        <div className="max-w-2xl space-y-1.5">
          <p className="text-xs font-medium text-amber-400">
            Candle Data Collector · Per-Slot Historical Profiling
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
            Collect Data for Every Candle
          </h1>
          <p className="text-sm leading-relaxed text-slate-400">
            Aggregate complete directional statistics, streaks, average range, volume, and full
            chronological history for every unique UTC candle slot across one or all uploaded
            timeframes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={!result || sortedSlots.length === 0 || isCollecting}
            onClick={handleExportCsv}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#2A3950] bg-[#111824] px-3.5 text-xs font-medium text-slate-100 transition-colors hover:border-amber-500/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export Collected Summary CSV</span>
          </button>

          <button
            type="button"
            disabled={!result || isCollecting}
            onClick={handleExportPdf}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded bg-amber-500 px-4 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Download Collected Report as PDF</span>
          </button>
        </div>
      </div>

      {/* Controls & Scope Panel */}
      <section
        aria-label="Collector scope and grouping controls"
        className="space-y-4 rounded border border-[#1E293B] bg-[#111824] p-5"
      >
        {/* Row 1: Timeframe Selector + Collect All + Adaptive Grouping Mode */}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] space-y-1.5">
              <label
                htmlFor="collector-tf-select"
                className="block text-xs font-semibold text-slate-200"
              >
                Timeframe Scope
              </label>
              <select
                id="collector-tf-select"
                value={config.scope}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    scope: e.target.value as TimeframeId | 'ALL',
                  })
                }
                className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                {loadedTimeframes.map((tf) => (
                  <option key={tf.id} value={tf.id}>
                    {tf.id} — {tf.label} ({datasets[tf.id]!.rowCount.toLocaleString()} rows)
                  </option>
                ))}
                <option value="ALL">
                  ALL UPLOADED ({loadedTimeframes.length} timeframes)
                </option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => onChangeConfig({ ...config, scope: 'ALL' })}
              className={`inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border px-4 text-xs font-semibold transition-colors ${
                config.scope === 'ALL'
                  ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                  : 'border-[#2A3950] bg-[#0B0F17] text-slate-200 hover:border-amber-500/60 hover:text-amber-300'
              }`}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Collect Across All Uploaded Timeframes ({loadedTimeframes.length})</span>
            </button>
          </div>

          {/* Adaptive Grouping Modes */}
          <div className="flex flex-wrap items-end gap-4">
            {hasIntraday && (
              <div className="space-y-1.5">
                <span className="block text-[11px] font-medium text-slate-400">
                  Intraday Grouping
                </span>
                <div className="flex items-center gap-1 rounded border border-[#1E293B] bg-[#0B0F17] p-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeConfig({
                        ...config,
                        grouping: { ...config.grouping, intraday: 'utc_time' },
                      })
                    }
                    className={`whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      config.grouping.intraday === 'utc_time'
                        ? 'bg-[#1E293B] text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    UTC Time (HH:MM)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeConfig({
                        ...config,
                        grouping: { ...config.grouping, intraday: 'dow_utc_time' },
                      })
                    }
                    className={`whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      config.grouping.intraday === 'dow_utc_time'
                        ? 'bg-[#1E293B] text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Day of Week + UTC Time
                  </button>
                </div>
              </div>
            )}

            {hasDaily && (
              <div className="space-y-1.5">
                <span className="block text-[11px] font-medium text-slate-400">
                  Daily (1D) Grouping
                </span>
                <div className="flex items-center gap-1 rounded border border-[#1E293B] bg-[#0B0F17] p-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeConfig({
                        ...config,
                        grouping: { ...config.grouping, daily: 'day_of_week' },
                      })
                    }
                    className={`whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      config.grouping.daily === 'day_of_week'
                        ? 'bg-[#1E293B] text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Day of Week
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeConfig({
                        ...config,
                        grouping: { ...config.grouping, daily: 'day_of_month' },
                      })
                    }
                    className={`whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      config.grouping.daily === 'day_of_month'
                        ? 'bg-[#1E293B] text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Day of Month (1–31)
                  </button>
                </div>
              </div>
            )}

            {hasWeekly && (
              <div className="space-y-1.5">
                <span className="block text-[11px] font-medium text-slate-400">
                  Weekly (1W) Grouping
                </span>
                <div className="flex items-center gap-1 rounded border border-[#1E293B] bg-[#0B0F17] p-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeConfig({
                        ...config,
                        grouping: { ...config.grouping, weekly: 'week_of_month' },
                      })
                    }
                    className={`whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      config.grouping.weekly === 'week_of_month'
                        ? 'bg-[#1E293B] text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Week of Month (1–5)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeConfig({
                        ...config,
                        grouping: { ...config.grouping, weekly: 'iso_week' },
                      })
                    }
                    className={`whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      config.grouping.weekly === 'iso_week'
                        ? 'bg-[#1E293B] text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ISO Week (1–53)
                  </button>
                </div>
              </div>
            )}

            {hasMonthly && (
              <div className="space-y-1.5">
                <span className="block text-[11px] font-medium text-slate-400">
                  Monthly (1M) Grouping
                </span>
                <div className="flex h-9 items-center rounded border border-[#1E293B] bg-[#0B0F17] px-3 text-xs font-medium text-amber-400">
                  Month of Year (Jan–Dec)
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Filters (Search, Date Range, Min N, Exclude Doji Toggle) */}
        <div className="grid grid-cols-1 gap-3 border-t border-[#1E293B] pt-4 md:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <label
              htmlFor="collector-search"
              className="mb-1 block text-[11px] font-medium text-slate-400"
            >
              Jump to Candle Slot
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                id="collector-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search slot e.g. 14:00, Monday, 1H..."
                className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="collector-start-date"
              className="mb-1 block text-[11px] font-medium text-slate-400"
            >
              Start Date (UTC)
            </label>
            <input
              id="collector-start-date"
              type="date"
              value={config.startDateUtc}
              onChange={(e) =>
                onChangeConfig({ ...config, startDateUtc: e.target.value })
              }
              className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-2.5 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="collector-end-date"
              className="mb-1 block text-[11px] font-medium text-slate-400"
            >
              End Date (UTC)
            </label>
            <input
              id="collector-end-date"
              type="date"
              value={config.endDateUtc}
              onChange={(e) =>
                onChangeConfig({ ...config, endDateUtc: e.target.value })
              }
              className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-2.5 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="lg:col-span-1">
            <label
              htmlFor="collector-min-n"
              className="mb-1 block whitespace-nowrap text-[11px] font-medium text-slate-400"
            >
              Min N
            </label>
            <input
              id="collector-min-n"
              type="number"
              min={1}
              value={config.minOccurrences}
              onChange={(e) =>
                onChangeConfig({
                  ...config,
                  minOccurrences: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-2.5 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex items-end justify-between gap-3 md:col-span-2 lg:col-span-3">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={config.excludeDojiFromPct}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    excludeDojiFromPct: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-[#2A3950] bg-[#0B0F17] accent-amber-500"
              />
              <span>Exclude Doji from %</span>
            </label>

            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-amber-400"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Live Progress Bar for Large Datasets */}
        {isCollecting && progress && (
          <div className="space-y-1.5 border-t border-[#1E293B] pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">
                Collecting candle slot metrics
                {progress.currentTimeframe ? ` (${progress.currentTimeframe})` : ''}...
              </span>
              <span className="font-mono tabular-nums text-amber-400">
                {progress.percent}% · {progress.candlesProcessed.toLocaleString()} /{' '}
                {progress.totalCandles.toLocaleString()} candles
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-[#0B0F17]">
              <div
                className="h-full bg-amber-500 transition-transform duration-150"
                style={{
                  transform: `scaleX(${progress.percent / 100})`,
                  transformOrigin: 'left',
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Warning Notice */}
      {result?.warningMessage && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <p>{result.warningMessage}</p>
        </div>
      )}

      {/* Summary KPI Strip */}
      {result && (
        <section
          aria-label="Collected data summary KPIs"
          className="grid grid-cols-2 divide-y divide-[#1E293B] rounded border border-[#1E293B] bg-[#111824] lg:grid-cols-4 lg:divide-x lg:divide-y-0"
        >
          <div className="p-4">
            <p className="text-[11px] text-slate-400">Candle Slots Collected</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {sortedSlots.length.toLocaleString()}
              <span className="ml-1.5 text-xs font-normal text-slate-500">
                of {result.totalSlotsCollected.toLocaleString()}
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Across {result.timeframesCollected.join(', ')}
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">Total Candles Scanned</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {result.totalCandlesScanned.toLocaleString()}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              Collected in {result.computeDurationMs.toFixed(1)} ms
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">High Consistency (≥ 70%)</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
              <span className="text-emerald-400">{summaryStats.highBull} Bull</span>
              <span className="mx-2 text-slate-600">·</span>
              <span className="text-red-400">{summaryStats.highBear} Bear</span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {config.excludeDojiFromPct ? 'Excl. Doji denominator' : 'Incl. Doji denominator'}
            </p>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-slate-400">Strongest Consistency Slot</p>
            <p
              className={`mt-1 truncate font-mono text-sm font-semibold ${
                summaryStats.topSlot?.dominantDirection === 'BEARISH'
                  ? 'text-red-400'
                  : 'text-emerald-400'
              }`}
              title={summaryStats.topSlot?.displayLabel}
            >
              {summaryStats.topSlot
                ? `${summaryStats.topSlot.displayLabel} · ${summaryStats.topSlot.dominancePct.toFixed(1)}%`
                : '—'}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              {summaryStats.topSlot
                ? `${summaryStats.topSlot.dominantDirection} · N=${summaryStats.topSlot.validNonDojiCount}`
                : 'No valid slots'}
            </p>
          </div>
        </section>
      )}

      {/* Collected Candle Slots Table (Sortable & Paginated for 1,440+ 1MIN slots) */}
      <section aria-label="Collected candle slots table" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Every Collected Candle Slot
            </h2>
            <p className="text-xs text-slate-400">
              Click any row to inspect its complete chronological history or export that slot&apos;s
              CSV.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-slate-400">
            <label className="inline-flex items-center gap-1.5">
              <span>Rows/page:</span>
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-8 rounded border border-[#2A3950] bg-[#111824] px-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
              </select>
            </label>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous table page"
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className="px-1">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next table page"
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
                  <th className="px-3.5 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('slot')}
                      className="inline-flex items-center gap-1 hover:text-slate-100"
                    >
                      <span>Timeframe &amp; Slot</span>
                      {renderSortIcon('slot')}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('totalOccurrences')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Total N</span>
                      {renderSortIcon('totalOccurrences')}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('validNonDojiCount')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Non-Doji</span>
                      {renderSortIcon('validNonDojiCount')}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('bullishPct')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Bullish</span>
                      {renderSortIcon('bullishPct')}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('bearishPct')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Bearish</span>
                      {renderSortIcon('bearishPct')}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('dojiCount')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Doji</span>
                      {renderSortIcon('dojiCount')}
                    </button>
                  </th>
                  <th className="px-3 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('dominancePct')}
                      className="inline-flex items-center gap-1 hover:text-slate-100"
                    >
                      <span>Dominance</span>
                      {renderSortIcon('dominancePct')}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('avgDiff')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Avg Diff</span>
                      {renderSortIcon('avgDiff')}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('avgRange')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Avg Range</span>
                      {renderSortIcon('avgRange')}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('avgVolume')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Avg Vol</span>
                      {renderSortIcon('avgVolume')}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('longestBullishStreak')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-100"
                    >
                      <span>Streaks (B/S)</span>
                      {renderSortIcon('longestBullishStreak')}
                    </button>
                  </th>
                  <th className="px-3.5 py-3 text-right font-medium">Target Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E293B]">
                {pageSlots.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-6 py-12 text-center">
                      <p className="text-sm font-medium text-slate-300">
                        No collected candle slots matched your current filter criteria
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Try clearing the search bar, expanding the UTC date range, or lowering Min
                        N.
                      </p>
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="mt-4 inline-flex h-9 items-center gap-1.5 rounded border border-[#2A3950] bg-[#0B0F17] px-3.5 text-xs font-medium text-amber-400 hover:border-amber-500/60"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Reset Collector Filters</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  pageSlots.map((s) => {
                    const isHighBull =
                      s.validNonDojiCount > 0 &&
                      s.dominantDirection === 'BULLISH' &&
                      s.dominancePct >= 70;
                    const isHighBear =
                      s.validNonDojiCount > 0 &&
                      s.dominantDirection === 'BEARISH' &&
                      s.dominancePct >= 70;

                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedSlot(s)}
                        className={`cursor-pointer transition-colors ${
                          isHighBull
                            ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.09]'
                            : isHighBear
                              ? 'bg-red-500/[0.04] hover:bg-red-500/[0.09]'
                              : 'hover:bg-[#162032]'
                        }`}
                      >
                        <td className="whitespace-nowrap px-3.5 py-2.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSlot(s);
                            }}
                            className="text-left font-mono font-semibold text-slate-100 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                          >
                            <span className="text-slate-400">{s.timeframe}</span>
                            <span aria-hidden="true" className="mx-1.5 text-slate-600">
                              —
                            </span>
                            <span>{s.slotLabel}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-200">
                          {s.totalOccurrences.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-300">
                          {s.validNonDojiCount.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                          <span className="font-medium text-emerald-400">
                            {s.bullishPct.toFixed(1)}%
                          </span>
                          <span className="ml-1.5 text-[11px] text-slate-500">
                            ({s.bullishCount})
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                          <span className="font-medium text-red-400">
                            {s.bearishPct.toFixed(1)}%
                          </span>
                          <span className="ml-1.5 text-[11px] text-slate-500">
                            ({s.bearishCount})
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-amber-400/90">
                          {s.dojiCount}
                          <span className="ml-1 text-[11px] text-slate-500">
                            ({s.dojiPct.toFixed(1)}%)
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums">
                          {s.dominantDirection === 'NEUTRAL' ? (
                            <span className="text-slate-500">0.0%</span>
                          ) : isHighBull ? (
                            <span className="inline-flex items-center rounded-[3px] border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                              BULL {s.dominancePct.toFixed(1)}%
                            </span>
                          ) : isHighBear ? (
                            <span className="inline-flex items-center rounded-[3px] border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                              BEAR {s.dominancePct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-slate-300">
                              {s.dominantDirection === 'BULLISH' ? 'BULL' : 'BEAR'}{' '}
                              {s.dominancePct.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums ${
                            s.avgDiff > 0
                              ? 'text-emerald-400'
                              : s.avgDiff < 0
                                ? 'text-red-400'
                                : 'text-slate-400'
                          }`}
                        >
                          {s.avgDiff > 0
                            ? `+${formatDecimal(s.avgDiff, 2)}`
                            : formatDecimal(s.avgDiff, 2)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-slate-300">
                          {formatDecimal(s.avgRange, 2)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-slate-400">
                          {formatDecimal(s.avgVolume, 4)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                          <span className="text-emerald-400">{s.longestBullishStreak}</span>
                          <span className="mx-1 text-slate-600">/</span>
                          <span className="text-red-400">{s.longestBearishStreak}</span>
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
                          <button
                            type="button"
                            aria-label={`Use ${s.displayLabel} as Target Candle`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onUseAsTargetCandle(s);
                            }}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-[#2A3950] bg-[#0B0F17] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:border-amber-500/70 hover:text-amber-300"
                          >
                            <Crosshair className="h-3 w-3 text-amber-400" aria-hidden="true" />
                            <span>Use as Target Candle</span>
                          </button>
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

      {/* Row Drill-Down Modal */}
      <SlotHistoryModal
        slot={activeModalSlot}
        excludeDojiFromPct={config.excludeDojiFromPct}
        onClose={() => setSelectedSlot(null)}
        onUseAsTarget={(slot) => {
          setSelectedSlot(null);
          onUseAsTargetCandle(slot);
        }}
      />
    </div>
  );
}
