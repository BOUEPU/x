export type TimeframeId =
  | '1MIN'
  | '5MIN'
  | '10MIN'
  | '15MIN'
  | '30MIN'
  | '1H'
  | '4H'
  | '1D'
  | '1W'
  | '1M';

export type CandleType = 'BULLISH' | 'BEARISH' | 'DOJI';

export type TimingRelation = 'BEFORE' | 'INSIDE' | 'AFTER';

export type AnalysisMode = 'cross' | 'same';

export type CrossAlignmentStrategy = 'parent_window' | 'specific_slot';

export type SameTfStrategy = 'specific_slot' | 'relative_offset';

export type DirectionFilter = 'both' | 'bullish' | 'bearish';

export interface TimeframeMeta {
  id: TimeframeId;
  label: string;
  shortLabel: string;
  durationMs: number;
  isIntraday: boolean;
  rankOrder: number;
}

export const TIMEFRAMES: readonly TimeframeMeta[] = [
  { id: '1MIN', label: '1 Minute', shortLabel: '1MIN', durationMs: 60_000, isIntraday: true, rankOrder: 1 },
  { id: '5MIN', label: '5 Minutes', shortLabel: '5MIN', durationMs: 5 * 60_000, isIntraday: true, rankOrder: 2 },
  { id: '10MIN', label: '10 Minutes', shortLabel: '10MIN', durationMs: 10 * 60_000, isIntraday: true, rankOrder: 3 },
  { id: '15MIN', label: '15 Minutes', shortLabel: '15MIN', durationMs: 15 * 60_000, isIntraday: true, rankOrder: 4 },
  { id: '30MIN', label: '30 Minutes', shortLabel: '30MIN', durationMs: 30 * 60_000, isIntraday: true, rankOrder: 5 },
  { id: '1H', label: '1 Hour', shortLabel: '1H', durationMs: 60 * 60_000, isIntraday: true, rankOrder: 6 },
  { id: '4H', label: '4 Hours', shortLabel: '4H', durationMs: 4 * 60 * 60_000, isIntraday: true, rankOrder: 7 },
  { id: '1D', label: '1 Day', shortLabel: '1D', durationMs: 24 * 60 * 60_000, isIntraday: false, rankOrder: 8 },
  { id: '1W', label: '1 Week', shortLabel: '1W', durationMs: 7 * 24 * 60 * 60_000, isIntraday: false, rankOrder: 9 },
  { id: '1M', label: '1 Month', shortLabel: '1M', durationMs: 30 * 24 * 60 * 60_000, isIntraday: false, rankOrder: 10 },
] as const;

export const TIMEFRAME_MAP: Record<TimeframeId, TimeframeMeta> = TIMEFRAMES.reduce(
  (acc, tf) => {
    acc[tf.id] = tf;
    return acc;
  },
  {} as Record<TimeframeId, TimeframeMeta>
);

export interface RawCandle {
  timestamp: number; // Strict UTC epoch milliseconds
  timeStr: string;   // Canonical YYYY.MM.DD HH:MM:SS (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EnrichedCandle extends RawCandle {
  diff: number;            // Precision-safe Close - Open rounded to 8 decimals
  candleType: CandleType;
}

export interface MalformedRow {
  lineNumber: number;
  rawLine: string;
  reason: string;
}

export interface AuditSummary {
  totalCandles: number;
  bullishCount: number;
  bearishCount: number;
  dojiCount: number;
  auditStatus: '100% Verified';
  autoFixedErrors: number;
  verifiedAtUtc: string;
}

export type DatasetStatus = 'empty' | 'parsing' | 'loaded' | 'verified' | 'error';

export interface TimeframeDataset {
  timeframe: TimeframeId;
  fileName: string;
  fileSizeBytes: number;
  status: DatasetStatus;
  candles: EnrichedCandle[];
  rowCount: number;
  duplicateCount: number;
  malformedRows: MalformedRow[];
  malformedCount: number;
  startUtcMs: number | null;
  endUtcMs: number | null;
  startUtcStr: string | null;
  endUtcStr: string | null;
  audit: AuditSummary;
  headersDetected: string[];
  errorMessage?: string;
}

export interface ParseProgress {
  timeframe: TimeframeId;
  fileName: string;
  percent: number;
  rowsParsed: number;
  stage: 'reading' | 'sorting' | 'auditing';
}

export interface SlotOption {
  key: string;
  label: string;
  sortOrder: number;
  count: number;
}

export interface AnalysisConfig {
  mode: AnalysisMode;
  targetTimeframe: TimeframeId;
  searchTimeframe: TimeframeId;
  crossStrategy: CrossAlignmentStrategy;
  sameStrategy: SameTfStrategy;
  targetSlotKey: string | null; // Used in specific_slot modes
  maxLagCandles: number;        // Used in same-TF relative_offset mode (e.g. 1..24)
  includeLeadOffsets: boolean;  // Optional Target +1..+N in relative_offset mode
  startDateUtc: string;         // YYYY-MM-DD (inclusive) or ''
  endDateUtc: string;           // YYYY-MM-DD (inclusive) or ''
}

export interface PairRecord {
  cycleKey: string;
  cycleDateStr: string;
  targetTimestamp: number;
  targetTimeStr: string;
  targetOpen: number;
  targetClose: number;
  targetDiff: number;
  targetType: CandleType;
  principalTimestamp: number;
  principalTimeStr: string;
  principalOpen: number;
  principalClose: number;
  principalDiff: number;
  principalType: CandleType;
  isMatch: boolean;
  isDojiExcluded: boolean;
  timingRelation: TimingRelation;
}

export interface PrincipalCandidateResult {
  slotKey: string;
  slotLabel: string;
  slotSortOrder: number;
  searchTimeframe: TimeframeId;
  totalValidPairs: number;       // N (strictly non-Doji pairs)
  excludedDojiPairs: number;     // Pairs skipped because Target or Principal was Doji
  targetBullishCount: number;
  bullishMatches: number;
  bullishMatchRate: number | null; // % or null if targetBullishCount === 0
  targetBearishCount: number;
  bearishMatches: number;
  bearishMatchRate: number | null; // % or null if targetBearishCount === 0
  overallAlignmentScore: number;   // % (0..100)
  timingRelation: TimingRelation;
  timingDetail: string;            // e.g. "Closes 15h before Target"
  pairs: PairRecord[];             // Full date-by-date breakdown (including Doji flags for transparency)
}

export interface AnalysisResult {
  config: AnalysisConfig;
  targetDescription: string;
  searchDescription: string;
  overlapStartUtc: string | null;
  overlapEndUtc: string | null;
  effectiveStartUtc: string | null;
  effectiveEndUtc: string | null;
  totalCyclesScanned: number;
  totalValidCycles: number;
  totalExcludedTargetDojis: number;
  totalExcludedDojiPairs: number;
  candidates: PrincipalCandidateResult[];
  warningMessage: string | null;
  computedAtUtc: string;
  computeDurationMs: number;
}

export interface ResultsFilterState {
  searchQuery: string;
  minAlignmentPct: number;
  minSampleSize: number;
  directionFilter: DirectionFilter;
  beforeCloseOnly: boolean;
  startDateUtc: string;
  endDateUtc: string;
}

// ============================================================================
// Candle Data Collector Types
// ============================================================================

export type IntradayGrouping = 'utc_time' | 'dow_utc_time';
export type DailyGrouping = 'day_of_week' | 'day_of_month';
export type WeeklyGrouping = 'week_of_month' | 'iso_week';
export type MonthlyGrouping = 'month_of_year';

export interface CollectorGroupingOptions {
  intraday: IntradayGrouping;
  daily: DailyGrouping;
  weekly: WeeklyGrouping;
  monthly: MonthlyGrouping;
}

export interface CollectorConfig {
  scope: TimeframeId | 'ALL';
  grouping: CollectorGroupingOptions;
  startDateUtc: string;
  endDateUtc: string;
  excludeDojiFromPct: boolean;
  minOccurrences: number;
}

export type DominantDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface CollectedCandleSlot {
  id: string;
  timeframe: TimeframeId;
  slotKey: string;
  slotLabel: string;
  displayLabel: string;
  slotSortOrder: number;
  groupingUsed: string;
  totalOccurrences: number;
  validNonDojiCount: number;
  bullishCount: number;
  bullishPct: number;
  bearishCount: number;
  bearishPct: number;
  dojiCount: number;
  dojiPct: number;
  dominantDirection: DominantDirection;
  dominancePct: number;
  avgDiff: number;
  avgRange: number;
  avgVolume: number;
  longestBullishStreak: number;
  longestBearishStreak: number;
  history: EnrichedCandle[];
}

export interface CollectorProgress {
  percent: number;
  candlesProcessed: number;
  totalCandles: number;
  currentTimeframe: TimeframeId | null;
}

export interface CollectorResult {
  config: CollectorConfig;
  timeframesCollected: TimeframeId[];
  totalCandlesScanned: number;
  totalSlotsCollected: number;
  slots: CollectedCandleSlot[];
  computedAtUtc: string;
  computeDurationMs: number;
  warningMessage: string | null;
}

// ============================================================================
// Best Matched Candles Search Types (Multi-Timeframe & Single-File Modes)
// ============================================================================

export type StepEngineMode = 'best_matches' | 'principal_target';

export type BestMatchSearchScope = 'multi_tf' | 'single_file';

export type MultiTfAnchorMode = 'lowest_tf' | 'parent_window';

export type SingleFileSubMode = 'reference' | 'auto_scan';

export type SequenceLength = 1 | 2 | 3;

export type MaxResultsLimit = 10 | 25 | 50 | 100;

export interface CandleGeometryFeatures {
  range: number;          // High - Low
  bodySize: number;       // |Close - Open|
  bodyRatio: number;      // 0..1 (0 when range === 0)
  upperWickRatio: number; // 0..1
  lowerWickRatio: number; // 0..1
  atr14: number;          // Rolling 14-candle range average
  rangeAtrRatio: number;  // range / atr14 (0 if flat and atr14 === 0)
  volumeRatio: number;    // volume / rolling 20-candle average volume (1 if avgVol === 0)
}

export interface BestMatchConfig {
  scope: BestMatchSearchScope;
  // Mode A: Cross-Timeframe Match Search
  selectedTimeframes: TimeframeId[];
  multiTfAnchor: MultiTfAnchorMode;
  // Mode B: Single-File / Intra-Timeframe Pattern Match Search
  singleTimeframe: TimeframeId;
  singleSubMode: SingleFileSubMode;
  sequenceLength: SequenceLength;
  referenceTimestamp: number | null; // null => Use Latest Candle/Sequence in File
  includeVolumeWeight: boolean;
  // Shared Scoring & Output Controls
  minMatchScore: number; // 0..100 (default 75)
  maxResults: MaxResultsLimit;
  startDateUtc: string;
  endDateUtc: string;
}

export interface MatchedCandleSnapshot {
  timeframe: TimeframeId;
  roleLabel: string; // e.g. '1H' or 'Bar 1 of 3'
  candle: EnrichedCandle;
  features: CandleGeometryFeatures;
}

export interface BestMatchItem {
  id: string;
  rank: number;
  anchorTimeframe: TimeframeId;
  timestamp: number;
  timeStr: string;
  endTimeStr: string;
  matchScore: number;       // 0..100 composite score
  directionalScore: number; // 0..100
  structuralScore: number;  // 0..100
  volumeScore: number | null;
  dominantDirection: CandleType;
  patternLabel: string;
  summaryDetail: string;
  snapshots: MatchedCandleSnapshot[];
}

export interface BestMatchProgress {
  percent: number;
  scanned: number;
  total: number;
  stage: 'indexing' | 'scoring' | 'ranking';
}

export interface BestMatchResult {
  config: BestMatchConfig;
  scope: BestMatchSearchScope;
  activeTimeframes: TimeframeId[];
  referenceSnapshots: MatchedCandleSnapshot[] | null;
  totalCandidatesScanned: number;
  totalAboveThreshold: number;
  effectiveStartUtc: string | null;
  effectiveEndUtc: string | null;
  matches: BestMatchItem[];
  warningMessage: string | null;
  computedAtUtc: string;
  computeDurationMs: number;
  usedWorker: boolean;
}

export interface BestMatchFilterState {
  searchQuery: string;
  directionFilter: 'all' | 'bullish' | 'bearish' | 'doji';
  minScoreOverride: number;
}

// ============================================================================
// Intraday Time-Slot Direction Correlation & Full-Matrix Collector Types
// ============================================================================

export type BestMatchEngineSubMode = 'intraday_slot' | 'geometric_pattern';

export type IntradaySlotScopeMode = 'single_anchor' | 'full_matrix';

export type IntradayDirectionFilter = 'any_non_doji' | 'bullish_only' | 'bearish_only';

export interface IntradaySlotMatchConfig {
  scopeMode: IntradaySlotScopeMode;
  anchorTimeframe: TimeframeId;
  anchorSlotKey: string;
  targetTimeframes: TimeframeId[];
  directionFilter: IntradayDirectionFilter;
  excludeSelfSlot: boolean;
  minCoOccurringDays: number;
  minMatchRatePct: number;
  maxResults: MaxResultsLimit;
  startDateUtc: string;
  endDateUtc: string;
}

export interface IntradayDayRecord {
  dateStr: string;
  anchorCandle: EnrichedCandle;
  targetCandle: EnrichedCandle;
  isMatch: boolean;
  matchDirection: 'BULLISH' | 'BEARISH' | null;
}

export interface IntradaySlotMatchItem {
  id: string;
  rank: number;
  anchorTimeframe: TimeframeId;
  anchorSlotKey: string;
  targetTimeframe: TimeframeId;
  targetSlotKey: string;
  targetSlotSortOrder: number;
  totalCoOccurringDays: number;
  matchedDays: number;
  bullishMatches: number;
  bearishMatches: number;
  matchRatePct: number;
  dayRecords: IntradayDayRecord[];
}

export interface IntradayFullMatrixAnchorSummary {
  id: string;
  anchorTimeframe: TimeframeId;
  anchorSlotKey: string;
  anchorSlotSortOrder: number;
  totalValidAnchorDays: number;
  bullishAnchorDays: number;
  bearishAnchorDays: number;
  bestTarget: IntradaySlotMatchItem | null;
  topTargets: IntradaySlotMatchItem[];
  top5AvgMatchRatePct: number;
  overallAvgMatchRatePct: number;
}

export interface IntradaySlotMatchResult {
  config: IntradaySlotMatchConfig;
  scopeMode: IntradaySlotScopeMode;
  anchorTimeframe: TimeframeId;
  anchorSlotKey: string | null;
  targetTimeframes: TimeframeId[];
  totalValidDaysEvaluated: number;
  totalAnchorSlotsEvaluated: number;
  totalPairwiseEvaluations: number;
  effectiveStartUtc: string | null;
  effectiveEndUtc: string | null;
  matches: IntradaySlotMatchItem[];
  matrixSummaries: IntradayFullMatrixAnchorSummary[];
  warningMessage: string | null;
  computedAtUtc: string;
  computeDurationMs: number;
  usedWorker: boolean;
}

export interface IntradaySlotFilterState {
  searchQuery: string;
  targetTimeframeFilter: TimeframeId | 'ALL';
  directionBiasFilter: 'all' | 'bullish_dominant' | 'bearish_dominant';
  minRateOverride: number;
}



