import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Crosshair,
  Layers,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  computeCandleFeaturesForSlice,
  getReferencePreviewSnapshots,
} from '../engine/matchPreview';
import {
  computeDateOverlap,
  getAvailableSlotsForTimeframe,
  resolveCycleUnit,
} from '../engine/correlation';
import { formatUtcDateIso, getCandleEndMs } from '../engine/csvParser';
import { WORKER_ROW_THRESHOLD, countScannedCandlesForConfig } from '../engine/runBestMatch';
import {
  AnalysisConfig,
  BestMatchConfig,
  BestMatchProgress,
  MaxResultsLimit,
  SequenceLength,
  StepEngineMode,
  TimeframeDataset,
  TimeframeId,
  TIMEFRAMES,
  TIMEFRAME_MAP,
} from '../engine/types';
import { SnapshotStripGlyphs } from './CandleGlyph';

interface StepConfigureProps {
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>;
  engineMode: StepEngineMode;
  onChangeEngineMode: (mode: StepEngineMode) => void;
  // Principal vs Target props
  config: AnalysisConfig;
  prefilledTargetNotice?: string | null;
  onDismissPrefilledNotice?: () => void;
  onChangeConfig: (next: AnalysisConfig) => void;
  onRunAnalysis: () => void;
  isRunning: boolean;
  // Best Matched Candles props
  bestMatchConfig: BestMatchConfig;
  onChangeBestMatchConfig: (next: BestMatchConfig) => void;
  onRunBestMatch: () => void;
  isRunningBestMatch: boolean;
  bestMatchProgress: BestMatchProgress | null;
  onBack: () => void;
}

const MAX_SELECT_OPTIONS = 250;

export function StepConfigure({
  datasets,
  engineMode,
  onChangeEngineMode,
  config,
  prefilledTargetNotice,
  onDismissPrefilledNotice,
  onChangeConfig,
  onRunAnalysis,
  isRunning,
  bestMatchConfig,
  onChangeBestMatchConfig,
  onRunBestMatch,
  isRunningBestMatch,
  bestMatchProgress,
  onBack,
}: StepConfigureProps) {
  const [refSearchQuery, setRefSearchQuery] = useState('');

  const loadedTimeframes = useMemo(
    () =>
      TIMEFRAMES.filter((t) => datasets[t.id] && datasets[t.id]!.candles.length > 0),
    [datasets]
  );

  // =========================================================================
  // PRINCIPAL VS TARGET DERIVED STATE
  // =========================================================================
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

  // =========================================================================
  // BEST MATCHED CANDLES DERIVED STATE
  // =========================================================================
  const activeMultiTfs = useMemo(
    () =>
      bestMatchConfig.selectedTimeframes
        .filter((tf) => Boolean(datasets[tf] && datasets[tf]!.candles.length > 0))
        .sort((a, b) => TIMEFRAME_MAP[a].rankOrder - TIMEFRAME_MAP[b].rankOrder),
    [bestMatchConfig.selectedTimeframes, datasets]
  );

  const multiTfOverlap = useMemo(() => {
    if (activeMultiTfs.length < 2) {
      return { hasOverlap: false, startIso: null as string | null, endIso: null as string | null };
    }
    let startMs = -Infinity;
    let endMs = Infinity;
    for (const tf of activeMultiTfs) {
      const ds = datasets[tf]!;
      if (ds.startUtcMs !== null && ds.startUtcMs > startMs) startMs = ds.startUtcMs;
      if (ds.endUtcMs !== null) {
        const wEnd = getCandleEndMs(ds.endUtcMs, tf) - 1;
        if (wEnd < endMs) endMs = wEnd;
      }
    }
    if (startMs > endMs || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return { hasOverlap: false, startIso: null, endIso: null };
    }
    return {
      hasOverlap: true,
      startIso: formatUtcDateIso(startMs),
      endIso: formatUtcDateIso(endMs),
    };
  }, [activeMultiTfs, datasets]);

  const singleDs = datasets[bestMatchConfig.singleTimeframe] ?? datasets[loadedTimeframes[0]?.id ?? '1H'];

  const singleRefOptions = useMemo(() => {
    if (!singleDs || singleDs.candles.length === 0) return [];
    const candles = singleDs.candles;
    const maxStartIdx = Math.max(0, candles.length - bestMatchConfig.sequenceLength);
    const q = refSearchQuery.trim().toLowerCase();

    if (!q) {
      // Show latest up to MAX_SELECT_OPTIONS candles in reverse chronological order
      const start = Math.max(0, maxStartIdx - MAX_SELECT_OPTIONS + 1);
      const out = [];
      for (let i = maxStartIdx; i >= start; i--) {
        out.push({ idx: i, candle: candles[i] });
      }
      return out;
    }

    const matched = [];
    for (let i = maxStartIdx; i >= 0 && matched.length < MAX_SELECT_OPTIONS; i--) {
      if (candles[i].timeStr.toLowerCase().includes(q)) {
        matched.push({ idx: i, candle: candles[i] });
      }
    }
    return matched;
  }, [singleDs, bestMatchConfig.sequenceLength, refSearchQuery]);

  const referencePreview = useMemo(() => {
    if (
      bestMatchConfig.scope !== 'single_file' ||
      bestMatchConfig.singleSubMode !== 'reference' ||
      !singleDs ||
      singleDs.candles.length === 0
    ) {
      return null;
    }
    const feat = computeCandleFeaturesForSlice(
      singleDs.candles,
      bestMatchConfig.referenceTimestamp,
      bestMatchConfig.sequenceLength
    );
    return getReferencePreviewSnapshots(
      singleDs.timeframe,
      singleDs.candles,
      feat,
      bestMatchConfig.referenceTimestamp,
      bestMatchConfig.sequenceLength
    );
  }, [
    bestMatchConfig.scope,
    bestMatchConfig.singleSubMode,
    bestMatchConfig.referenceTimestamp,
    bestMatchConfig.sequenceLength,
    singleDs,
  ]);

  const scannedRowCount = useMemo(
    () => countScannedCandlesForConfig(datasets, bestMatchConfig),
    [datasets, bestMatchConfig]
  );

  const willUseWorker = scannedRowCount > WORKER_ROW_THRESHOLD;

  const canRunBestMatch =
    bestMatchConfig.scope === 'multi_tf'
      ? activeMultiTfs.length >= 2 && multiTfOverlap.hasOverlap && !isRunningBestMatch
      : Boolean(singleDs && singleDs.candles.length >= bestMatchConfig.sequenceLength) &&
        !isRunningBestMatch;

  const toggleMultiTf = (tf: TimeframeId) => {
    const exists = bestMatchConfig.selectedTimeframes.includes(tf);
    const next = exists
      ? bestMatchConfig.selectedTimeframes.filter((id) => id !== tf)
      : [...bestMatchConfig.selectedTimeframes, tf];
    onChangeBestMatchConfig({
      ...bestMatchConfig,
      selectedTimeframes: next,
    });
  };

  const handleSelectAllUploaded = () => {
    onChangeBestMatchConfig({
      ...bestMatchConfig,
      selectedTimeframes: loadedTimeframes.map((t) => t.id),
    });
  };

  return (
    <div className="space-y-8">
      {/* Header + Engine Mode Switcher */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#1E293B] pb-6 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <p className="text-xs font-medium text-amber-400">
            Step 3 of 4 · Quantitative Search &amp; Correlation Engine
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
            {engineMode === 'best_matches'
              ? 'Configure Best Matched Candles Search'
              : 'Configure Target Candle & Search Scope'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {engineMode === 'best_matches'
              ? `Search and rank top-scoring candle alignments across any 2+ uploaded timeframes or find structural pattern matches inside a single CSV (${loadedTimeframes.length} uploaded).`
              : 'Define which Target Candle direction to explain and which candidate Principal Candle slots to rank across your verified UTC history.'}
          </p>
        </div>

        {/* Engine Switcher */}
        <div
          role="group"
          aria-label="Analysis engine selection"
          className="inline-flex shrink-0 items-center gap-1 self-start rounded border border-[#1E293B] bg-[#111824] p-1 lg:self-auto"
        >
          <button
            type="button"
            onClick={() => onChangeEngineMode('best_matches')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-3.5 py-2 text-xs font-semibold transition-colors ${
              engineMode === 'best_matches'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-[#162032] hover:text-slate-100'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Best Matched Candles</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeEngineMode('principal_target')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-3.5 py-2 text-xs font-semibold transition-colors ${
              engineMode === 'principal_target'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-[#162032] hover:text-slate-100'
            }`}
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Principal vs. Target</span>
          </button>
        </div>
      </div>

      {engineMode === 'principal_target' && prefilledTargetNotice && (
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

      {/* =================================================================== */}
      {/* ENGINE A: BEST MATCHED CANDLES SEARCH                               */}
      {/* =================================================================== */}
      {engineMode === 'best_matches' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Configuration Column */}
          <div className="space-y-6 rounded border border-[#1E293B] bg-[#111824] p-6 lg:col-span-7">
            {/* Search Scope Switcher */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-200">
                Search Scope
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!canCrossTimeframe}
                  onClick={() =>
                    onChangeBestMatchConfig({ ...bestMatchConfig, scope: 'multi_tf' })
                  }
                  className={`rounded border px-4 py-3 text-left transition-colors ${
                    bestMatchConfig.scope === 'multi_tf'
                      ? 'border-amber-500 bg-amber-500/10 text-slate-50'
                      : canCrossTimeframe
                        ? 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                        : 'cursor-not-allowed border-[#1E293B] bg-[#0B0F17]/50 text-slate-600'
                  }`}
                >
                  <div className="text-sm font-semibold">Cross-Timeframe Match Search</div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {canCrossTimeframe
                      ? 'Select any 2 or more uploaded timeframes to score synchronized polarity & candle shape.'
                      : 'Upload at least 2 timeframes in Step 1 to unlock Multi-Timeframe Search.'}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onChangeBestMatchConfig({ ...bestMatchConfig, scope: 'single_file' })
                  }
                  className={`rounded border px-4 py-3 text-left transition-colors ${
                    bestMatchConfig.scope === 'single_file'
                      ? 'border-amber-500 bg-amber-500/10 text-slate-50'
                      : 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="text-sm font-semibold">Single-File Pattern Search</div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Works with just 1 CSV. Find historical clones of a reference candle/sequence or
                    auto-scan cleanest setups.
                  </p>
                </button>
              </div>
            </div>

            {/* MODE A: MULTI-TIMEFRAME CONTROLS */}
            {bestMatchConfig.scope === 'multi_tf' ? (
              <div className="space-y-5 border-t border-[#1E293B] pt-5">
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-200">
                      Select Uploaded Timeframes (Pick 2 or more · {activeMultiTfs.length} active)
                    </span>
                    <button
                      type="button"
                      onClick={handleSelectAllUploaded}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:underline"
                    >
                      <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Select All Uploaded ({loadedTimeframes.length})</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {loadedTimeframes.map((tf) => {
                      const isSelected = bestMatchConfig.selectedTimeframes.includes(tf.id);
                      return (
                        <button
                          key={tf.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleMultiTf(tf.id)}
                          className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded border px-3 font-mono text-xs font-medium transition-colors ${
                            isSelected
                              ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                              : 'border-[#2A3950] bg-[#0B0F17] text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          {isSelected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                          <span>{tf.id}</span>
                          <span className="text-[11px] text-slate-500">
                            ({datasets[tf.id]!.rowCount.toLocaleString()})
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {activeMultiTfs.length < 2 && (
                    <p className="text-xs text-amber-400">
                      Select at least 2 timeframes above to run cross-timeframe alignment.
                    </p>
                  )}
                </div>

                {/* Timestamp Alignment Anchor Toggle */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-200">
                    Timestamp Alignment Anchor
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onChangeBestMatchConfig({
                          ...bestMatchConfig,
                          multiTfAnchor: 'lowest_tf',
                        })
                      }
                      className={`rounded border px-3.5 py-2 text-xs font-medium transition-colors ${
                        bestMatchConfig.multiTfAnchor === 'lowest_tf'
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      Lowest Selected TF Bar ({activeMultiTfs[0] ?? '—'})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeBestMatchConfig({
                          ...bestMatchConfig,
                          multiTfAnchor: 'parent_window',
                        })
                      }
                      className={`rounded border px-3.5 py-2 text-xs font-medium transition-colors ${
                        bestMatchConfig.multiTfAnchor === 'parent_window'
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      Parent Higher-TF Window ({activeMultiTfs[activeMultiTfs.length - 1] ?? '—'})
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {bestMatchConfig.multiTfAnchor === 'lowest_tf'
                      ? 'Evaluates every granular lower-timeframe candle alongside its enclosing higher-timeframe candles.'
                      : 'Evaluates each completed higher-timeframe parent window paired with the closing candle of each selected lower timeframe.'}
                  </p>
                </div>
              </div>
            ) : (
              /* MODE B: SINGLE-FILE PATTERN MATCH CONTROLS */
              <div className="space-y-5 border-t border-[#1E293B] pt-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="bm-single-tf"
                      className="block text-xs font-semibold text-slate-200"
                    >
                      Timeframe File to Search
                    </label>
                    <select
                      id="bm-single-tf"
                      value={singleDs?.timeframe ?? ''}
                      onChange={(e) =>
                        onChangeBestMatchConfig({
                          ...bestMatchConfig,
                          singleTimeframe: e.target.value as TimeframeId,
                          referenceTimestamp: null,
                        })
                      }
                      className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                    >
                      {loadedTimeframes.map((tf) => (
                        <option key={tf.id} value={tf.id}>
                          {tf.id} — {tf.label} ({datasets[tf.id]!.rowCount.toLocaleString()} rows)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <span className="block text-xs font-semibold text-slate-200">
                      Sequence Length (K)
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([1, 2, 3] as SequenceLength[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() =>
                            onChangeBestMatchConfig({ ...bestMatchConfig, sequenceLength: k })
                          }
                          className={`h-10 rounded border font-mono text-xs font-medium transition-colors ${
                            bestMatchConfig.sequenceLength === k
                              ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                              : 'border-[#2A3950] bg-[#0B0F17] text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          {k} {k === 1 ? 'Bar' : 'Bars'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Single-File Sub-Mode: Reference Pattern vs Auto-Scan */}
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-slate-200">
                    Single-File Discovery Method
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onChangeBestMatchConfig({
                          ...bestMatchConfig,
                          singleSubMode: 'reference',
                        })
                      }
                      className={`rounded border px-3.5 py-2 text-xs font-medium transition-colors ${
                        bestMatchConfig.singleSubMode === 'reference'
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      Target Reference Candle / Sequence
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeBestMatchConfig({
                          ...bestMatchConfig,
                          singleSubMode: 'auto_scan',
                        })
                      }
                      className={`rounded border px-3.5 py-2 text-xs font-medium transition-colors ${
                        bestMatchConfig.singleSubMode === 'auto_scan'
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      Auto-Scan Best Structural Setups
                    </button>
                  </div>
                </div>

                {/* Reference Picker (when Reference sub-mode active) */}
                {bestMatchConfig.singleSubMode === 'reference' && singleDs && (
                  <div className="space-y-3 rounded border border-[#1E293B] bg-[#0D131E] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200">
                        Select Reference Start Candle ({singleDs.timeframe})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onChangeBestMatchConfig({
                            ...bestMatchConfig,
                            referenceTimestamp: null,
                          })
                        }
                        className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          bestMatchConfig.referenceTimestamp === null
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-[#2A3950] bg-[#0B0F17] text-slate-300 hover:border-amber-500/50'
                        }`}
                      >
                        Use Latest Candle in File
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                      <div className="relative sm:col-span-5">
                        <Search
                          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={refSearchQuery}
                          onChange={(e) => setRefSearchQuery(e.target.value)}
                          placeholder="Filter timestamp e.g. 2021.01.04"
                          aria-label="Filter reference candle UTC timestamps"
                          className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] pl-8 pr-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-7">
                        <select
                          aria-label="Choose reference UTC candle"
                          value={
                            bestMatchConfig.referenceTimestamp !== null
                              ? String(bestMatchConfig.referenceTimestamp)
                              : 'LATEST'
                          }
                          onChange={(e) =>
                            onChangeBestMatchConfig({
                              ...bestMatchConfig,
                              referenceTimestamp:
                                e.target.value === 'LATEST' ? null : Number(e.target.value),
                            })
                          }
                          className="h-9 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-2.5 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                        >
                          <option value="LATEST">
                            Latest in File ({singleDs.candles[Math.max(0, singleDs.candles.length - bestMatchConfig.sequenceLength)]?.timeStr})
                          </option>
                          {singleRefOptions.map((opt) => (
                            <option key={opt.candle.timestamp} value={String(opt.candle.timestamp)}>
                              #{opt.idx + 1} · {opt.candle.timeStr} ({opt.candle.candleType})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {referencePreview && (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1E293B] pt-3">
                        <div className="text-xs text-slate-300">
                          <span className="font-semibold text-slate-100">Reference Shape: </span>
                          <span className="font-mono text-slate-400">
                            {referencePreview.map((s) => `${s.candle.timeStr} (${s.candle.candleType})`).join(' → ')}
                          </span>
                        </div>
                        <SnapshotStripGlyphs snapshots={referencePreview} sharedScale={true} />
                      </div>
                    )}
                  </div>
                )}

                {/* Optional Relative Volume Weighting Toggle */}
                <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={bestMatchConfig.includeVolumeWeight}
                    onChange={(e) =>
                      onChangeBestMatchConfig({
                        ...bestMatchConfig,
                        includeVolumeWeight: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-[#2A3950] bg-[#0B0F17] accent-amber-500"
                  />
                  <span>
                    Include relative volume ratio (vs. 20-bar avg) in similarity score (15% weight)
                  </span>
                </label>
              </div>
            )}

            {/* Shared Scoring Threshold & Max Results */}
            <div className="grid grid-cols-1 gap-5 border-t border-[#1E293B] pt-5 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="min-match-slider"
                    className="text-xs font-semibold text-slate-200"
                  >
                    Min Match Score Threshold
                  </label>
                  <span className="font-mono text-xs font-semibold tabular-nums text-amber-400">
                    {bestMatchConfig.minMatchScore}%
                  </span>
                </div>
                <input
                  id="min-match-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={bestMatchConfig.minMatchScore}
                  onChange={(e) =>
                    onChangeBestMatchConfig({
                      ...bestMatchConfig,
                      minMatchScore: Number(e.target.value),
                    })
                  }
                  className="w-full accent-amber-500"
                />
                <div className="flex justify-between font-mono text-[10px] text-slate-500">
                  <span>0% (All)</span>
                  <span>75% (Default)</span>
                  <span>100% (Exact)</span>
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-200">
                  Max Results Returned
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  {([10, 25, 50, 100] as MaxResultsLimit[]).map((lim) => (
                    <button
                      key={lim}
                      type="button"
                      onClick={() =>
                        onChangeBestMatchConfig({ ...bestMatchConfig, maxResults: lim })
                      }
                      className={`h-9 rounded border font-mono text-xs font-medium transition-colors ${
                        bestMatchConfig.maxResults === lim
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-[#2A3950] bg-[#0B0F17] text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      Top {lim}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Optional UTC Date Window */}
            <div className="space-y-3 border-t border-[#1E293B] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  UTC Date Window Filter (Optional)
                </span>
                {(bestMatchConfig.startDateUtc || bestMatchConfig.endDateUtc) && (
                  <button
                    type="button"
                    onClick={() =>
                      onChangeBestMatchConfig({
                        ...bestMatchConfig,
                        startDateUtc: '',
                        endDateUtc: '',
                      })
                    }
                    className="text-xs font-medium text-amber-400 hover:underline"
                  >
                    Reset Dates
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="bm-start-date" className="block text-xs text-slate-400">
                    Start Date (UTC)
                  </label>
                  <input
                    id="bm-start-date"
                    type="date"
                    value={bestMatchConfig.startDateUtc}
                    onChange={(e) =>
                      onChangeBestMatchConfig({
                        ...bestMatchConfig,
                        startDateUtc: e.target.value,
                      })
                    }
                    className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="bm-end-date" className="block text-xs text-slate-400">
                    End Date (UTC)
                  </label>
                  <input
                    id="bm-end-date"
                    type="date"
                    value={bestMatchConfig.endDateUtc}
                    onChange={(e) =>
                      onChangeBestMatchConfig({
                        ...bestMatchConfig,
                        endDateUtc: e.target.value,
                      })
                    }
                    className="h-10 w-full rounded border border-[#2A3950] bg-[#0B0F17] px-3 font-mono text-xs tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Execution Summary Column */}
          <aside className="flex flex-col justify-between space-y-6 rounded border border-[#1E293B] bg-[#111824] p-6 lg:col-span-5">
            <div className="space-y-5">
              <h2 className="text-sm font-semibold text-slate-100">
                Match Scoring Scope &amp; Guardrails
              </h2>

              {bestMatchConfig.scope === 'multi_tf' &&
                activeMultiTfs.length >= 2 &&
                !multiTfOverlap.hasOverlap && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-200"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-red-300">Non-Overlapping Date Ranges</p>
                      <p className="mt-0.5 leading-relaxed">
                        The selected timeframes ({activeMultiTfs.join(', ')}) do not share a common
                        UTC date window. Adjust selection or switch to Single-File Pattern Search.
                      </p>
                    </div>
                  </div>
                )}

              <dl className="divide-y divide-[#1E293B] text-xs">
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-slate-400">Search Mode</dt>
                  <dd className="font-medium text-slate-100">
                    {bestMatchConfig.scope === 'multi_tf'
                      ? 'Cross-Timeframe Match'
                      : bestMatchConfig.singleSubMode === 'reference'
                        ? `Single-File Reference (K=${bestMatchConfig.sequenceLength})`
                        : `Single-File Auto-Scan (K=${bestMatchConfig.sequenceLength})`}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-slate-400">Active Timeframe(s)</dt>
                  <dd className="font-mono text-slate-100">
                    {bestMatchConfig.scope === 'multi_tf'
                      ? activeMultiTfs.join(' · ') || 'None'
                      : singleDs?.timeframe ?? 'None'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-slate-400">Candles in Scope</dt>
                  <dd className="font-mono tabular-nums text-slate-100">
                    {scannedRowCount.toLocaleString()} rows
                    {willUseWorker ? ' (Web Worker)' : ''}
                  </dd>
                </div>
                {bestMatchConfig.scope === 'multi_tf' && (
                  <div className="flex justify-between gap-4 py-2.5">
                    <dt className="text-slate-400">Common UTC Overlap</dt>
                    <dd className="font-mono tabular-nums text-slate-200">
                      {multiTfOverlap.hasOverlap
                        ? `${multiTfOverlap.startIso} → ${multiTfOverlap.endIso}`
                        : 'No overlap'}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-slate-400">Score Formula</dt>
                  <dd className="text-right text-slate-200">
                    {bestMatchConfig.scope === 'multi_tf'
                      ? '55% Polarity + 45% OHLC/ATR Shape'
                      : bestMatchConfig.singleSubMode === 'reference'
                        ? bestMatchConfig.includeVolumeWeight
                          ? '40% Polarity + 45% Shape + 15% Vol'
                          : '45% Polarity + 55% OHLC/ATR Shape'
                        : bestMatchConfig.includeVolumeWeight
                          ? '35% Polarity + 50% Setup + 15% Vol'
                          : '40% Polarity + 60% Setup Quality'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-slate-400">Output Cap &amp; Floor</dt>
                  <dd className="font-mono tabular-nums text-amber-300">
                    Top {bestMatchConfig.maxResults} · Score ≥ {bestMatchConfig.minMatchScore}%
                  </dd>
                </div>
              </dl>

              {isRunningBestMatch && bestMatchProgress && (
                <div className="space-y-1.5 rounded border border-[#1E293B] bg-[#0B0F17] p-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">
                      Running {bestMatchProgress.stage} pass...
                    </span>
                    <span className="font-mono tabular-nums text-amber-400">
                      {bestMatchProgress.percent}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-[#111824]">
                    <div
                      className="h-full bg-amber-500 transition-transform duration-150"
                      style={{
                        transform: `scaleX(${bestMatchProgress.percent / 100})`,
                        transformOrigin: 'left',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-[#1E293B] pt-5">
              <button
                type="button"
                disabled={!canRunBestMatch}
                onClick={onRunBestMatch}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-amber-500 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              >
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                <span>
                  {isRunningBestMatch
                    ? 'Searching Best Matches...'
                    : 'Find Best Matched Candles'}
                </span>
              </button>
              <p className="text-center text-[11px] text-slate-500">
                100% deterministic TypeScript geometry matching · Safe against zero-range Dojis
              </p>
            </div>
          </aside>
        </div>
      ) : (
        /* ================================================================= */
        /* ENGINE B: PRINCIPAL VS TARGET CANDLE CORRELATION (EXISTING)       */
        /* ================================================================= */
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
      )}

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
