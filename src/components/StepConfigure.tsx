import { useMemo } from 'react';
import { AlertTriangle, ArrowLeft, Crosshair, Play, X } from 'lucide-react';
import {
  computeDateOverlap,
  getAvailableSlotsForTimeframe,
  resolveCycleUnit,
} from '../engine/correlation';
import { formatUtcDateIso } from '../engine/csvParser';
import {
  AnalysisConfig,
  TimeframeDataset,
  TimeframeId,
  TIMEFRAMES,
  TIMEFRAME_MAP,
} from '../engine/types';

interface StepConfigureProps {
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>;
  config: AnalysisConfig;
  prefilledTargetNotice?: string | null;
  onDismissPrefilledNotice?: () => void;
  onChangeConfig: (next: AnalysisConfig) => void;
  onBack: () => void;
  onRunAnalysis: () => void;
  isRunning: boolean;
}

export function StepConfigure({
  datasets,
  config,
  prefilledTargetNotice,
  onDismissPrefilledNotice,
  onChangeConfig,
  onBack,
  onRunAnalysis,
  isRunning,
}: StepConfigureProps) {
  const loadedTimeframes = useMemo(
    () =>
      TIMEFRAMES.filter((t) => datasets[t.id] && datasets[t.id]!.candles.length > 0),
    [datasets]
  );

  const canCrossTimeframe = loadedTimeframes.length >= 2;
  const targetDs = datasets[config.targetTimeframe];
  const effectiveSearchTf =
    config.mode === 'same' ? config.targetTimeframe : config.searchTimeframe;
  const searchDs = datasets[effectiveSearchTf];

  const canUseParentWindow =
    config.mode === 'cross' &&
    TIMEFRAME_MAP[config.searchTimeframe].rankOrder <
      TIMEFRAME_MAP[config.targetTimeframe].rankOrder;

  const effectiveCrossStrategy =
    canUseParentWindow ? config.crossStrategy : 'specific_slot';

  const overlapInfo = useMemo(() => {
    if (!targetDs || !searchDs) {
      return { overlapStartIso: null, overlapEndIso: null, hasOverlap: false };
    }
    const ov = computeDateOverlap(targetDs, searchDs);
    return {
      overlapStartIso: ov.overlapStartMs !== null ? formatUtcDateIso(ov.overlapStartMs) : null,
      overlapEndIso: ov.overlapEndMs !== null ? formatUtcDateIso(ov.overlapEndMs) : null,
      hasOverlap: ov.hasOverlap,
    };
  }, [targetDs, searchDs]);

  const availableTargetSlots = useMemo(() => {
    if (!targetDs) return [];
    return getAvailableSlotsForTimeframe(
      targetDs.candles,
      config.targetTimeframe,
      effectiveSearchTf
    );
  }, [targetDs, config.targetTimeframe, effectiveSearchTf]);

  const cycleUnit = resolveCycleUnit(config.targetTimeframe, effectiveSearchTf);

  const handleModeSwitch = (mode: 'cross' | 'same') => {
    if (mode === 'cross' && !canCrossTimeframe) return;
    if (mode === 'cross') {
      // Pick sensible Target (highest TF) and Search (lower TF)
      const sortedByRank = loadedTimeframes.slice().sort((a, b) => b.rankOrder - a.rankOrder);
      const nextTarget =
        datasets[config.targetTimeframe] ? config.targetTimeframe : sortedByRank[0].id;
      const otherOptions = sortedByRank.filter((t) => t.id !== nextTarget);
      const nextSearch =
        config.searchTimeframe !== nextTarget && datasets[config.searchTimeframe]
          ? config.searchTimeframe
          : otherOptions[0].id;
      const supportsParent =
        TIMEFRAME_MAP[nextSearch].rankOrder < TIMEFRAME_MAP[nextTarget].rankOrder;
      onChangeConfig({
        ...config,
        mode: 'cross',
        targetTimeframe: nextTarget,
        searchTimeframe: nextSearch,
        crossStrategy: supportsParent ? 'parent_window' : 'specific_slot',
      });
    } else {
      onChangeConfig({
        ...config,
        mode: 'same',
        searchTimeframe: config.targetTimeframe,
      });
    }
  };

  const handleTargetTfChange = (nextTarget: TimeframeId) => {
    if (config.mode === 'same') {
      const nextDs = datasets[nextTarget];
      const nextSlots = nextDs
        ? getAvailableSlotsForTimeframe(nextDs.candles, nextTarget, nextTarget)
        : [];
      onChangeConfig({
        ...config,
        targetTimeframe: nextTarget,
        searchTimeframe: nextTarget,
        targetSlotKey:
          config.sameStrategy === 'relative_offset' ? '__ALL__' : (nextSlots[0]?.key ?? null),
      });
      return;
    }

    let nextSearch = config.searchTimeframe;
    if (nextSearch === nextTarget) {
      const alt = loadedTimeframes.find((t) => t.id !== nextTarget);
      if (alt) nextSearch = alt.id;
    }
    const supportsParent =
      TIMEFRAME_MAP[nextSearch].rankOrder < TIMEFRAME_MAP[nextTarget].rankOrder;
    const nextDs = datasets[nextTarget];
    const nextSlots = nextDs
      ? getAvailableSlotsForTimeframe(nextDs.candles, nextTarget, nextSearch)
      : [];

    onChangeConfig({
      ...config,
      targetTimeframe: nextTarget,
      searchTimeframe: nextSearch,
      crossStrategy: supportsParent ? 'parent_window' : 'specific_slot',
      targetSlotKey: nextSlots[0]?.key ?? null,
    });
  };

  const handleSearchTfChange = (nextSearch: TimeframeId) => {
    const supportsParent =
      TIMEFRAME_MAP[nextSearch].rankOrder < TIMEFRAME_MAP[config.targetTimeframe].rankOrder;
    const nextSlots = targetDs
      ? getAvailableSlotsForTimeframe(targetDs.candles, config.targetTimeframe, nextSearch)
      : [];

    onChangeConfig({
      ...config,
      searchTimeframe: nextSearch,
      crossStrategy: supportsParent ? 'parent_window' : 'specific_slot',
      targetSlotKey: nextSlots[0]?.key ?? null,
    });
  };

  const needsSlotDropdown =
    (config.mode === 'cross' && effectiveCrossStrategy === 'specific_slot') ||
    (config.mode === 'same' && config.sameStrategy === 'specific_slot');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b border-[#1E293B] pb-6">
        <p className="text-xs font-medium text-amber-400">
          Step 3 of 4 · Principal Candle vs. Target Candle Engine
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
          Configure Target Candle &amp; Search Scope
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Define which Target Candle direction to explain and which candidate Principal Candle
          slots to rank across your verified UTC history. Doji candles are strictly excluded from
          all alignment rates.
        </p>
      </div>

      {prefilledTargetNotice && (
        <div className="flex items-center justify-between gap-3 rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <span>
              Pre-selected from Candle Data Collector:{' '}
              <strong className="font-mono text-amber-100">{prefilledTargetNotice}</strong>. Review
              your Search Timeframe or click Run Correlation Analysis.
            </span>
          </div>
          {onDismissPrefilledNotice && (
            <button
              type="button"
              aria-label="Dismiss pre-selected target notice"
              onClick={onDismissPrefilledNotice}
              className="text-amber-300/80 hover:text-amber-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* Main 2-Column Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Controls */}
        <div className="space-y-6 rounded border border-[#1E293B] bg-[#111824] p-6 lg:col-span-7">
          {/* Analysis Mode Segmented Switch */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-200">
              Analysis Mode
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={!canCrossTimeframe}
                onClick={() => handleModeSwitch('cross')}
                className={`rounded border px-4 py-3 text-left transition-colors ${
                  config.mode === 'cross'
                    ? 'border-amber-500 bg-amber-500/10 text-slate-50'
                    : canCrossTimeframe
                      ? 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                      : 'cursor-not-allowed border-[#1E293B] bg-[#0B0F17]/50 text-slate-600'
                }`}
              >
                <div className="text-sm font-semibold">Cross-Timeframe Mode</div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {canCrossTimeframe
                    ? 'Align child candles (e.g. 1H) inside a parent Target (e.g. 1D) or compare slots across two timeframes.'
                    : 'Upload at least 2 timeframes in Step 1 to enable Cross-Timeframe Mode.'}
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleModeSwitch('same')}
                className={`rounded border px-4 py-3 text-left transition-colors ${
                  config.mode === 'same'
                    ? 'border-amber-500 bg-amber-500/10 text-slate-50'
                    : 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="text-sm font-semibold">Same-Timeframe Mode</div>
                <p className="mt-0.5 text-xs text-slate-400">
                  Compare a specific Target slot (e.g. 16:00 UTC or Monday) or relative lags
                  (Target − N) inside a single timeframe.
                </p>
              </button>
            </div>
          </div>

          {/* Timeframe Selectors */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="target-tf-select"
                className="block text-xs font-semibold text-slate-200"
              >
                {config.mode === 'cross' ? 'Target Timeframe' : 'Timeframe to Analyze'}
              </label>
              <select
                id="target-tf-select"
                value={config.targetTimeframe}
                onChange={(e) => handleTargetTfChange(e.target.value as TimeframeId)}
                className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                {loadedTimeframes.map((tf) => (
                  <option key={tf.id} value={tf.id}>
                    {tf.id} — {tf.label} ({datasets[tf.id]!.rowCount.toLocaleString()} rows)
                  </option>
                ))}
              </select>
            </div>

            {config.mode === 'cross' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="search-tf-select"
                  className="block text-xs font-semibold text-slate-200"
                >
                  Search Timeframe (Principal Candidates)
                </label>
                <select
                  id="search-tf-select"
                  value={config.searchTimeframe}
                  onChange={(e) => handleSearchTfChange(e.target.value as TimeframeId)}
                  className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  {loadedTimeframes
                    .filter((tf) => tf.id !== config.targetTimeframe)
                    .map((tf) => (
                      <option key={tf.id} value={tf.id}>
                        {tf.id} — {tf.label} ({datasets[tf.id]!.rowCount.toLocaleString()} rows)
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          {/* Strategy Selector */}
          {config.mode === 'cross' ? (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-200">
                Cross-Timeframe Alignment Method
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canUseParentWindow}
                  onClick={() =>
                    onChangeConfig({ ...config, crossStrategy: 'parent_window' })
                  }
                  className={`rounded border px-3.5 py-2 text-xs font-medium transition-colors ${
                    effectiveCrossStrategy === 'parent_window'
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : canUseParentWindow
                        ? 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                        : 'cursor-not-allowed border-[#1E293B] bg-[#0B0F17]/40 text-slate-600'
                  }`}
                >
                  Parent Period Window ({config.searchTimeframe} inside {config.targetTimeframe})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChangeConfig({
                      ...config,
                      crossStrategy: 'specific_slot',
                      targetSlotKey:
                        config.targetSlotKey &&
                        availableTargetSlots.some((s) => s.key === config.targetSlotKey)
                          ? config.targetSlotKey
                          : (availableTargetSlots[0]?.key ?? null),
                    })
                  }
                  className={`rounded border px-3.5 py-2 text-xs font-medium transition-colors ${
                    effectiveCrossStrategy === 'specific_slot'
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  Specific Target Slot ({cycleUnit} cycle)
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-200">
                Same-Timeframe Comparison Method
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onChangeConfig({
                      ...config,
                      sameStrategy: 'specific_slot',
                      targetSlotKey:
                        config.targetSlotKey &&
                        availableTargetSlots.some((s) => s.key === config.targetSlotKey)
                          ? config.targetSlotKey
                          : (availableTargetSlots[0]?.key ?? null),
                    })
                  }
                  className={`rounded border px-3.5 py-2 text-xs font-medium transition-colors ${
                    config.sameStrategy === 'specific_slot'
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  Specific Target Slot ({cycleUnit} cycle)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChangeConfig({
                      ...config,
                      sameStrategy: 'relative_offset',
                      targetSlotKey: '__ALL__',
                    })
                  }
                  className={`rounded border px-3.5 py-2 text-xs font-medium transition-colors ${
                    config.sameStrategy === 'relative_offset'
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  Relative Candle Offset (Target − N)
                </button>
              </div>
            </div>
          )}

          {/* Specific Slot Dropdown OR Relative Offset Settings */}
          {needsSlotDropdown && (
            <div className="space-y-1.5">
              <label
                htmlFor="target-slot-select"
                className="block text-xs font-semibold text-slate-200"
              >
                Target Candle Slot ({config.targetTimeframe})
              </label>
              <select
                id="target-slot-select"
                value={config.targetSlotKey ?? availableTargetSlots[0]?.key ?? ''}
                onChange={(e) =>
                  onChangeConfig({ ...config, targetSlotKey: e.target.value })
                }
                className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                {availableTargetSlots.map((slot) => (
                  <option key={slot.key} value={slot.key}>
                    {slot.label} ({slot.count.toLocaleString()} historical candles)
                  </option>
                ))}
              </select>
            </div>
          )}

          {config.mode === 'same' && config.sameStrategy === 'relative_offset' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="max-lag-input"
                  className="block text-xs font-semibold text-slate-200"
                >
                  Lookback Range (Target − 1 to − N)
                </label>
                <input
                  id="max-lag-input"
                  type="number"
                  min={1}
                  max={60}
                  value={config.maxLagCandles}
                  onChange={(e) =>
                    onChangeConfig({
                      ...config,
                      maxLagCandles: Math.max(1, Math.min(60, Number(e.target.value) || 1)),
                    })
                  }
                  className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="offset-slot-filter"
                  className="block text-xs font-semibold text-slate-200"
                >
                  Optional Target Slot Filter
                </label>
                <select
                  id="offset-slot-filter"
                  value={config.targetSlotKey ?? '__ALL__'}
                  onChange={(e) =>
                    onChangeConfig({ ...config, targetSlotKey: e.target.value })
                  }
                  className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="__ALL__">All {config.targetTimeframe} Candles</option>
                  {availableTargetSlots.map((slot) => (
                    <option key={slot.key} value={slot.key}>
                      Only {slot.label} ({slot.count.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={config.includeLeadOffsets}
                  onChange={(e) =>
                    onChangeConfig({ ...config, includeLeadOffsets: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-[#2A3950] bg-[#0B0F17] accent-amber-500"
                />
                <span>Also evaluate following candles (Target + 1 to Target + {config.maxLagCandles})</span>
              </label>
            </div>
          )}

          {/* UTC Date Range Filter */}
          <div className="space-y-3 border-t border-[#1E293B] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-200">
                UTC Date Window Filter (Optional)
              </span>
              {(config.startDateUtc || config.endDateUtc) && (
                <button
                  type="button"
                  onClick={() =>
                    onChangeConfig({ ...config, startDateUtc: '', endDateUtc: '' })
                  }
                  className="text-xs font-medium text-amber-400 hover:underline"
                >
                  Reset to Full Overlap
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="cfg-start-date" className="block text-xs text-slate-400">
                  Start Date (UTC)
                </label>
                <input
                  id="cfg-start-date"
                  type="date"
                  value={config.startDateUtc}
                  min={overlapInfo.overlapStartIso ?? undefined}
                  max={overlapInfo.overlapEndIso ?? undefined}
                  onChange={(e) =>
                    onChangeConfig({ ...config, startDateUtc: e.target.value })
                  }
                  className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="cfg-end-date" className="block text-xs text-slate-400">
                  End Date (UTC)
                </label>
                <input
                  id="cfg-end-date"
                  type="date"
                  value={config.endDateUtc}
                  min={overlapInfo.overlapStartIso ?? undefined}
                  max={overlapInfo.overlapEndIso ?? undefined}
                  onChange={(e) =>
                    onChangeConfig({ ...config, endDateUtc: e.target.value })
                  }
                  className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Deterministic Scope Preview & Guardrails */}
        <aside className="flex flex-col justify-between space-y-6 rounded border border-[#1E293B] bg-[#111824] p-6 lg:col-span-5">
          <div className="space-y-5">
            <h2 className="text-sm font-semibold text-slate-100">
              Execution Scope &amp; Mathematical Rules
            </h2>

            {!overlapInfo.hasOverlap && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-red-300">Non-Overlapping Date Ranges</p>
                  <p className="mt-0.5 leading-relaxed">
                    {config.targetTimeframe} ({targetDs?.startUtcStr} → {targetDs?.endUtcStr}) does
                    not overlap with {effectiveSearchTf} ({searchDs?.startUtcStr} →{' '}
                    {searchDs?.endUtcStr}). Select overlapping timeframes to run correlation.
                  </p>
                </div>
              </div>
            )}

            <dl className="divide-y divide-[#1E293B] text-xs">
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-slate-400">Mode</dt>
                <dd className="font-medium text-slate-100">
                  {config.mode === 'cross' ? 'Cross-Timeframe' : 'Same-Timeframe'}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-slate-400">Target Dataset</dt>
                <dd className="font-mono tabular-nums text-slate-100">
                  {config.targetTimeframe} ({targetDs?.rowCount.toLocaleString() ?? 0} candles)
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-slate-400">Search Dataset</dt>
                <dd className="font-mono tabular-nums text-slate-100">
                  {effectiveSearchTf} ({searchDs?.rowCount.toLocaleString() ?? 0} candles)
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-slate-400">Overlapping UTC Range</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {overlapInfo.hasOverlap
                    ? `${overlapInfo.overlapStartIso} → ${overlapInfo.overlapEndIso}`
                    : 'No overlap'}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-slate-400">Doji Policy</dt>
                <dd className="font-medium text-amber-300">Strictly Excluded &amp; Tracked</dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-slate-400">Ranking Tie-Breaker</dt>
                <dd className="text-slate-200">Overall Score ↓ then Sample N ↓</dd>
              </div>
            </dl>
          </div>

          <div className="space-y-3 border-t border-[#1E293B] pt-5">
            <button
              type="button"
              disabled={!targetDs || !searchDs || isRunning}
              onClick={onRunAnalysis}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-amber-500 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              <span>{isRunning ? 'Computing Correlation...' : 'Run Correlation Analysis'}</span>
            </button>
            <p className="text-center text-[11px] text-slate-500">
              100% deterministic TypeScript calculation · Partial boundary days handled safely
            </p>
          </div>
        </aside>
      </div>

      {/* Bottom Navigation */}
      <div className="flex items-center justify-between border-t border-[#1E293B] pt-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#1E293B] bg-[#111824] px-4 text-sm font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-[#162032]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to Verification</span>
        </button>
      </div>
    </div>
  );
}
