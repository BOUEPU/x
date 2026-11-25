import { useCallback, useMemo, useState } from 'react';
import { StepCollector } from './components/StepCollector';
import { StepConfigure } from './components/StepConfigure';
import { StepResults } from './components/StepResults';
import { StepUpload } from './components/StepUpload';
import { StepVerify } from './components/StepVerify';
import { TopBar, WizardStep } from './components/TopBar';
import { runIndependentAuditPass } from './engine/audit';
import {
  buildTargetConfigFromCollectedSlot,
  DEFAULT_COLLECTOR_GROUPING,
} from './engine/collector';
import {
  filterAndRankBestMatches,
  filterAndRankCandidates,
  getAvailableSlotsForTimeframe,
  runCorrelationAnalysis,
} from './engine/correlation';
import { parseTimeframeFile } from './engine/parseFile';
import {
  exportBestMatchesReportPdf,
  exportCorrelationReportPdf,
} from './engine/pdfExport';
import { executeBestMatchSearchAsync } from './engine/runBestMatch';
import {
  AnalysisConfig,
  AnalysisResult,
  BestMatchConfig,
  BestMatchFilterState,
  BestMatchProgress,
  BestMatchResult,
  CollectedCandleSlot,
  CollectorConfig,
  CollectorResult,
  ParseProgress,
  ResultsFilterState,
  StepEngineMode,
  TimeframeDataset,
  TimeframeId,
  TIMEFRAMES,
  TIMEFRAME_MAP,
} from './engine/types';

const DEFAULT_FILTERS: ResultsFilterState = {
  searchQuery: '',
  minAlignmentPct: 0,
  minSampleSize: 1,
  directionFilter: 'both',
  beforeCloseOnly: false,
  startDateUtc: '',
  endDateUtc: '',
};

const DEFAULT_BEST_MATCH_FILTERS: BestMatchFilterState = {
  searchQuery: '',
  directionFilter: 'all',
  minScoreOverride: 0,
};

function buildDefaultBestMatchConfig(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>
): BestMatchConfig {
  const loadedIds = TIMEFRAMES.filter(
    (tf) => datasets[tf.id] && datasets[tf.id]!.candles.length > 0
  ).map((tf) => tf.id);

  return {
    scope: loadedIds.length >= 2 ? 'multi_tf' : 'single_file',
    selectedTimeframes: loadedIds,
    multiTfAnchor: 'lowest_tf',
    singleTimeframe: loadedIds[0] ?? '1H',
    singleSubMode: 'reference',
    sequenceLength: 1,
    referenceTimestamp: null,
    includeVolumeWeight: false,
    minMatchScore: 75,
    maxResults: 25,
    startDateUtc: '',
    endDateUtc: '',
  };
}

function buildDefaultConfig(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>
): AnalysisConfig {
  const loaded = TIMEFRAMES.filter(
    (tf) => datasets[tf.id] && datasets[tf.id]!.candles.length > 0
  );

  if (loaded.length >= 2) {
    const desc = loaded.slice().sort((a, b) => b.rankOrder - a.rankOrder);
    const targetTf = desc[0].id;
    const searchTf = desc[1].id;
    const supportsParent =
      TIMEFRAME_MAP[searchTf].rankOrder < TIMEFRAME_MAP[targetTf].rankOrder;
    return {
      mode: 'cross',
      targetTimeframe: targetTf,
      searchTimeframe: searchTf,
      crossStrategy: supportsParent ? 'parent_window' : 'specific_slot',
      sameStrategy: 'specific_slot',
      targetSlotKey: null,
      maxLagCandles: 12,
      includeLeadOffsets: false,
      startDateUtc: '',
      endDateUtc: '',
    };
  }

  const singleTf = loaded[0]?.id ?? '1H';
  const ds = datasets[singleTf];
  const firstSlot = ds
    ? getAvailableSlotsForTimeframe(ds.candles, singleTf, singleTf)[0]?.key ?? null
    : null;

  return {
    mode: 'same',
    targetTimeframe: singleTf,
    searchTimeframe: singleTf,
    crossStrategy: 'parent_window',
    sameStrategy: 'specific_slot',
    targetSlotKey: firstSlot,
    maxLagCandles: 12,
    includeLeadOffsets: false,
    startDateUtc: '',
    endDateUtc: '',
  };
}

export default function App() {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [datasets, setDatasets] = useState<Partial<Record<TimeframeId, TimeframeDataset>>>({});
  const [parseProgress, setParseProgress] = useState<Partial<Record<TimeframeId, ParseProgress>>>({});
  const [parseErrors, setParseErrors] = useState<Partial<Record<TimeframeId, string>>>({});
  const [selectedPreviewTf, setSelectedPreviewTf] = useState<TimeframeId | null>(null);

  const [engineMode, setEngineMode] = useState<StepEngineMode>('best_matches');
  const [config, setConfig] = useState<AnalysisConfig>(() => buildDefaultConfig({}));
  const [prefilledTargetNotice, setPrefilledTargetNotice] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false);
  const [filters, setFilters] = useState<ResultsFilterState>(DEFAULT_FILTERS);

  // Best Matched Candles Search state
  const [bestMatchConfig, setBestMatchConfig] = useState<BestMatchConfig>(() =>
    buildDefaultBestMatchConfig({})
  );
  const [bestMatchResult, setBestMatchResult] = useState<BestMatchResult | null>(null);
  const [isRunningBestMatch, setIsRunningBestMatch] = useState(false);
  const [bestMatchProgress, setBestMatchProgress] = useState<BestMatchProgress | null>(null);
  const [bestMatchFilters, setBestMatchFilters] = useState<BestMatchFilterState>(
    DEFAULT_BEST_MATCH_FILTERS
  );

  // Candle Data Collector state
  const [collectorConfig, setCollectorConfig] = useState<CollectorConfig>({
    scope: 'ALL',
    grouping: DEFAULT_COLLECTOR_GROUPING,
    startDateUtc: '',
    endDateUtc: '',
    excludeDojiFromPct: true,
    minOccurrences: 1,
  });
  const [collectorResult, setCollectorResult] = useState<CollectorResult | null>(null);

  const loadedTimeframes = useMemo(
    () =>
      TIMEFRAMES.map((t) => t.id).filter(
        (id) => datasets[id] && datasets[id]!.candles.length > 0
      ),
    [datasets]
  );

  const isParsingAny = Object.keys(parseProgress).length > 0;
  const activeHasResults =
    engineMode === 'best_matches' ? Boolean(bestMatchResult) : Boolean(analysisResult);

  const maxUnlockedStep: 1 | 2 | 3 | 4 = useMemo(() => {
    if (loadedTimeframes.length === 0) return 1;
    if (activeHasResults) return 4;
    return 3;
  }, [loadedTimeframes.length, activeHasResults]);

  const handleUploadFile = useCallback(async (tf: TimeframeId, file: File) => {
    setParseErrors((prev) => {
      const copy = { ...prev };
      delete copy[tf];
      return copy;
    });
    setParseProgress((prev) => ({
      ...prev,
      [tf]: {
        timeframe: tf,
        fileName: file.name,
        percent: 0,
        rowsParsed: 0,
        stage: 'reading',
      },
    }));

    try {
      const dataset = await parseTimeframeFile(tf, file, (progress) => {
        setParseProgress((prev) => ({ ...prev, [tf]: progress }));
      });

      setDatasets((prev) => ({ ...prev, [tf]: dataset }));
      setSelectedPreviewTf(tf);
      setAnalysisResult(null);
      setBestMatchResult(null);
      setCollectorResult(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to parse CSV file.';
      setParseErrors((prev) => ({ ...prev, [tf]: message }));
    } finally {
      setParseProgress((prev) => {
        const copy = { ...prev };
        delete copy[tf];
        return copy;
      });
    }
  }, []);

  const handleRemoveDataset = useCallback((tf: TimeframeId) => {
    setDatasets((prev) => {
      const copy = { ...prev };
      delete copy[tf];
      return copy;
    });
    setParseErrors((prev) => {
      const copy = { ...prev };
      delete copy[tf];
      return copy;
    });
    setSelectedPreviewTf((cur) => (cur === tf ? null : cur));
    setAnalysisResult(null);
    setBestMatchResult(null);
    setCollectorResult(null);
  }, []);

  const handleClearAll = useCallback(() => {
    setDatasets({});
    setParseErrors({});
    setSelectedPreviewTf(null);
    setAnalysisResult(null);
    setBestMatchResult(null);
    setBestMatchProgress(null);
    setCollectorResult(null);
    setPrefilledTargetNotice(null);
    setCurrentStep(1);
  }, []);

  const handleReRunAudit = useCallback(() => {
    setDatasets((prev) => {
      const updated: Partial<Record<TimeframeId, TimeframeDataset>> = {};
      for (const tf of TIMEFRAMES) {
        const ds = prev[tf.id];
        if (!ds) continue;
        const audited = runIndependentAuditPass(ds.candles);
        updated[tf.id] = {
          ...ds,
          status: 'verified',
          candles: audited.candles,
          audit: audited.summary,
        };
      }
      return updated;
    });
  }, []);

  const syncConfigWithDatasets = useCallback(
    (targetDatasets: Partial<Record<TimeframeId, TimeframeDataset>>) => {
      const loadedIds = TIMEFRAMES.filter(
        (t) => Boolean(targetDatasets[t.id] && targetDatasets[t.id]!.candles.length > 0)
      ).map((t) => t.id);

      setConfig((prev) => {
        const targetExists = Boolean(targetDatasets[prev.targetTimeframe]);
        const searchExists = Boolean(targetDatasets[prev.searchTimeframe]);
        const loadedCount = loadedIds.length;

        if (!targetExists || (prev.mode === 'cross' && (!searchExists || loadedCount < 2))) {
          return buildDefaultConfig(targetDatasets);
        }
        if (loadedCount >= 2 && prev.mode === 'same' && !analysisResult && !prefilledTargetNotice) {
          return buildDefaultConfig(targetDatasets);
        }
        return prev;
      });

      setBestMatchConfig((prev) => {
        const validSelected = prev.selectedTimeframes.filter((tf) =>
          Boolean(targetDatasets[tf] && targetDatasets[tf]!.candles.length > 0)
        );
        const singleExists = Boolean(
          targetDatasets[prev.singleTimeframe] &&
            targetDatasets[prev.singleTimeframe]!.candles.length > 0
        );

        let nextScope = prev.scope;
        if (loadedIds.length < 2) {
          nextScope = 'single_file';
        } else if (loadedIds.length >= 2 && !bestMatchResult && prev.selectedTimeframes.length === 0) {
          nextScope = 'multi_tf';
        }

        const nextSelected =
          validSelected.length >= 2
            ? validSelected
            : loadedIds.length >= 2
              ? loadedIds
              : validSelected;

        const nextSingle = singleExists ? prev.singleTimeframe : loadedIds[0] ?? prev.singleTimeframe;

        const nextRefTs =
          prev.referenceTimestamp !== null &&
          targetDatasets[nextSingle]?.candles.some((c) => c.timestamp === prev.referenceTimestamp)
            ? prev.referenceTimestamp
            : null;

        return {
          ...prev,
          scope: nextScope,
          selectedTimeframes: nextSelected,
          singleTimeframe: nextSingle,
          referenceTimestamp: nextRefTs,
        };
      });
    },
    [analysisResult, bestMatchResult, prefilledTargetNotice]
  );

  const goToStep = useCallback(
    (step: WizardStep) => {
      if (step === 3) {
        syncConfigWithDatasets(datasets);
      }
      if (step === 'collector' && loadedTimeframes.length === 1) {
        setCollectorConfig((prev) =>
          prev.scope !== 'ALL' && datasets[prev.scope]
            ? prev
            : { ...prev, scope: loadedTimeframes[0] }
        );
      }
      setCurrentStep(step);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [datasets, loadedTimeframes, syncConfigWithDatasets]
  );

  const handleUseAsTargetCandle = useCallback(
    (slot: CollectedCandleSlot) => {
      const prefilled = buildTargetConfigFromCollectedSlot(slot, datasets, {
        startDateUtc: collectorConfig.startDateUtc,
        endDateUtc: collectorConfig.endDateUtc,
      });
      setEngineMode('principal_target');
      setConfig(prefilled);
      setPrefilledTargetNotice(slot.displayLabel);
      setCurrentStep(3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [datasets, collectorConfig.startDateUtc, collectorConfig.endDateUtc]
  );

  const executeAnalysis = useCallback(
    (activeConfig: AnalysisConfig, resetDashboardFilters = true) => {
      setIsRunningAnalysis(true);
      setTimeout(() => {
        const res = runCorrelationAnalysis(datasets, activeConfig);
        setAnalysisResult(res);
        if (resetDashboardFilters) {
          setFilters({
            ...DEFAULT_FILTERS,
            startDateUtc: activeConfig.startDateUtc,
            endDateUtc: activeConfig.endDateUtc,
          });
        }
        setIsRunningAnalysis(false);
        setCurrentStep(4);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 20);
    },
    [datasets]
  );

  const executeBestMatch = useCallback(async () => {
    setIsRunningBestMatch(true);
    setBestMatchProgress({ percent: 5, scanned: 0, total: 100, stage: 'indexing' });
    try {
      const res = await executeBestMatchSearchAsync(datasets, bestMatchConfig, (progress) => {
        setBestMatchProgress(progress);
      });
      setBestMatchResult(res);
      setBestMatchFilters(DEFAULT_BEST_MATCH_FILTERS);
      setCurrentStep(4);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setIsRunningBestMatch(false);
      setBestMatchProgress(null);
    }
  }, [datasets, bestMatchConfig]);

  const handleDateRangeChangeOnResults = useCallback(
    (startDateUtc: string, endDateUtc: string) => {
      const nextConfig: AnalysisConfig = {
        ...config,
        startDateUtc,
        endDateUtc,
      };
      setConfig(nextConfig);
      setFilters((prev) => ({ ...prev, startDateUtc, endDateUtc }));
      const res = runCorrelationAnalysis(datasets, nextConfig);
      setAnalysisResult(res);
    },
    [config, datasets]
  );

  const handleTopBarPrimaryAction = () => {
    if (currentStep === 1) {
      goToStep(2);
    } else if (currentStep === 2) {
      goToStep(3);
    } else if (currentStep === 3) {
      if (engineMode === 'best_matches') {
        void executeBestMatch();
      } else {
        executeAnalysis(config, true);
      }
    } else if (currentStep === 4) {
      if (engineMode === 'best_matches' && bestMatchResult) {
        const filtered = filterAndRankBestMatches(bestMatchResult.matches, bestMatchFilters);
        exportBestMatchesReportPdf(bestMatchResult, filtered, bestMatchFilters);
      } else if (engineMode === 'principal_target' && analysisResult) {
        const filtered = filterAndRankCandidates(analysisResult.candidates, filters);
        exportCorrelationReportPdf(analysisResult, filtered, filters, datasets);
      }
    } else if (currentStep === 'collector') {
      goToStep(3);
    }
  };

  const step3BestMatchBlocked =
    engineMode === 'best_matches' &&
    bestMatchConfig.scope === 'multi_tf' &&
    bestMatchConfig.selectedTimeframes.length < 2;

  const primaryActionMeta = useMemo(() => {
    switch (currentStep) {
      case 1:
        return {
          label: 'Verify Data',
          disabled: loadedTimeframes.length === 0 || isParsingAny,
          isExport: false,
        };
      case 2:
        return {
          label: 'Configure Analysis',
          disabled: loadedTimeframes.length === 0,
          isExport: false,
        };
      case 3:
        if (engineMode === 'best_matches') {
          return {
            label: isRunningBestMatch ? 'Searching...' : 'Search Matches',
            disabled:
              loadedTimeframes.length === 0 || isRunningBestMatch || step3BestMatchBlocked,
            isExport: false,
          };
        }
        return {
          label: isRunningAnalysis ? 'Analyzing...' : 'Run Analysis',
          disabled: loadedTimeframes.length === 0 || isRunningAnalysis,
          isExport: false,
        };
      case 4:
        return {
          label: 'Export PDF',
          disabled: !activeHasResults,
          isExport: true,
        };
      case 'collector':
        return {
          label: 'Configure Analysis',
          disabled: loadedTimeframes.length === 0,
          isExport: true,
        };
    }
  }, [
    currentStep,
    loadedTimeframes.length,
    isParsingAny,
    engineMode,
    isRunningBestMatch,
    step3BestMatchBlocked,
    isRunningAnalysis,
    activeHasResults,
  ]);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#E2E8F0]">
      <TopBar
        currentStep={currentStep}
        maxUnlockedStep={maxUnlockedStep}
        loadedCount={loadedTimeframes.length}
        hasResults={activeHasResults}
        onSelectStep={goToStep}
        onPrimaryAction={handleTopBarPrimaryAction}
        primaryActionLabel={primaryActionMeta.label}
        primaryActionDisabled={primaryActionMeta.disabled}
        isExportAction={primaryActionMeta.isExport}
      />

      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:py-10">
        {currentStep === 1 && (
          <StepUpload
            datasets={datasets}
            parseProgress={parseProgress}
            parseErrors={parseErrors}
            selectedPreviewTf={selectedPreviewTf}
            onSelectPreviewTf={setSelectedPreviewTf}
            onUploadFile={handleUploadFile}
            onRemoveDataset={handleRemoveDataset}
            onClearAll={handleClearAll}
            onProceed={() => goToStep(2)}
          />
        )}

        {currentStep === 2 && (
          <StepVerify
            datasets={datasets}
            onReRunAudit={handleReRunAudit}
            onBack={() => goToStep(1)}
            onOpenCollector={() => goToStep('collector')}
            onProceed={() => goToStep(3)}
          />
        )}

        {currentStep === 3 && (
          <StepConfigure
            datasets={datasets}
            engineMode={engineMode}
            onChangeEngineMode={setEngineMode}
            config={config}
            prefilledTargetNotice={prefilledTargetNotice}
            onDismissPrefilledNotice={() => setPrefilledTargetNotice(null)}
            onChangeConfig={(next) => {
              setConfig(next);
              setPrefilledTargetNotice(null);
            }}
            onRunAnalysis={() => executeAnalysis(config, true)}
            isRunning={isRunningAnalysis}
            bestMatchConfig={bestMatchConfig}
            onChangeBestMatchConfig={setBestMatchConfig}
            onRunBestMatch={() => void executeBestMatch()}
            isRunningBestMatch={isRunningBestMatch}
            bestMatchProgress={bestMatchProgress}
            onBack={() => goToStep(2)}
          />
        )}

        {currentStep === 4 && activeHasResults && (
          <StepResults
            engineMode={engineMode}
            result={analysisResult}
            datasets={datasets}
            filters={filters}
            onChangeFilters={setFilters}
            onDateRangeChange={handleDateRangeChangeOnResults}
            bestMatchResult={bestMatchResult}
            bestMatchFilters={bestMatchFilters}
            onChangeBestMatchFilters={setBestMatchFilters}
            onBackToConfigure={() => goToStep(3)}
          />
        )}

        {currentStep === 'collector' && loadedTimeframes.length > 0 && (
          <StepCollector
            datasets={datasets}
            config={collectorConfig}
            result={collectorResult}
            onChangeConfig={setCollectorConfig}
            onResultReady={setCollectorResult}
            onUseAsTargetCandle={handleUseAsTargetCandle}
          />
        )}
      </main>
    </div>
  );
}
