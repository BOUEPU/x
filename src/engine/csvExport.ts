import { formatDecimal, serializeEnrichedCandlesToCsv } from './csvParser';
import {
  AnalysisResult,
  BestMatchItem,
  BestMatchResult,
  CollectedCandleSlot,
  CollectorResult,
  PrincipalCandidateResult,
  TimeframeDataset,
} from './types';

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports a single verified timeframe dataset with Diff and Candle_Type appended.
 */
export function downloadProcessedTimeframeCsv(dataset: TimeframeDataset): void {
  const csv = serializeEnrichedCandlesToCsv(dataset.candles);
  const safeBase = dataset.fileName.replace(/\.csv$/i, '') || `btc_${dataset.timeframe.toLowerCase()}`;
  triggerDownload(csv, `${safeBase}_${dataset.timeframe}_verified.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Exports all loaded & verified timeframe datasets sequentially with a slight delay
 * so browsers do not throttle simultaneous downloads.
 */
export function downloadAllProcessedCsvs(datasets: TimeframeDataset[]): void {
  datasets.forEach((ds, index) => {
    setTimeout(() => {
      downloadProcessedTimeframeCsv(ds);
    }, index * 220);
  });
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Exports the ranked Principal Candles correlation table as CSV.
 */
export function downloadCorrelationResultsCsv(
  result: AnalysisResult,
  filteredCandidates: PrincipalCandidateResult[]
): void {
  const headers = [
    'Rank',
    'Principal Candle Slot',
    'Search Timeframe',
    'Overall Alignment (%)',
    'Bullish Match (%)',
    'Bullish Matches',
    'Target Bullish Count',
    'Bearish Match (%)',
    'Bearish Matches',
    'Target Bearish Count',
    'Sample Size (N)',
    'Excluded Doji Pairs',
    'Timing Relation',
    'Timing Detail',
  ];

  const rows: string[] = [headers.join(',')];

  filteredCandidates.forEach((c, idx) => {
    const row = [
      idx + 1,
      escapeCsvCell(c.slotLabel),
      c.searchTimeframe,
      formatDecimal(c.overallAlignmentScore, 2),
      c.bullishMatchRate !== null ? formatDecimal(c.bullishMatchRate, 2) : 'N/A',
      c.bullishMatches,
      c.targetBullishCount,
      c.bearishMatchRate !== null ? formatDecimal(c.bearishMatchRate, 2) : 'N/A',
      c.bearishMatches,
      c.targetBearishCount,
      c.totalValidPairs,
      c.excludedDojiPairs,
      c.timingRelation,
      escapeCsvCell(c.timingDetail),
    ];
    rows.push(row.join(','));
  });

  const targetSlug = result.config.targetTimeframe.toLowerCase();
  const searchSlug =
    result.config.mode === 'same'
      ? `${targetSlug}_same`
      : result.config.searchTimeframe.toLowerCase();
  const dateTag = (result.effectiveEndUtc || 'report').replace(/[^0-9-]/g, '');

  triggerDownload(
    rows.join('\n'),
    `btc_correlation_${targetSlug}_vs_${searchSlug}_${dateTag}.csv`,
    'text/csv;charset=utf-8;'
  );
}

/**
 * Exports all collected candle slots summary with the exact required schema:
 * Timeframe,Candle_Slot,Total_N,Valid_Non_Doji,Bullish_Count,Bullish_Pct,Bearish_Count,Bearish_Pct,
 * Doji_Count,Dominant_Direction,Dominance_Pct,Avg_Diff,Avg_Range,Avg_Volume,Max_Bull_Streak,Max_Bear_Streak
 */
export function downloadCollectedSummaryCsv(
  result: CollectorResult,
  filteredSlots: CollectedCandleSlot[]
): void {
  const headers = [
    'Timeframe',
    'Candle_Slot',
    'Total_N',
    'Valid_Non_Doji',
    'Bullish_Count',
    'Bullish_Pct',
    'Bearish_Count',
    'Bearish_Pct',
    'Doji_Count',
    'Dominant_Direction',
    'Dominance_Pct',
    'Avg_Diff',
    'Avg_Range',
    'Avg_Volume',
    'Max_Bull_Streak',
    'Max_Bear_Streak',
  ];

  const rows: string[] = [headers.join(',')];

  for (let i = 0; i < filteredSlots.length; i++) {
    const s = filteredSlots[i];
    rows.push(
      [
        s.timeframe,
        escapeCsvCell(s.slotLabel),
        s.totalOccurrences,
        s.validNonDojiCount,
        s.bullishCount,
        s.bullishPct.toFixed(2),
        s.bearishCount,
        s.bearishPct.toFixed(2),
        s.dojiCount,
        s.dominantDirection,
        s.dominancePct.toFixed(2),
        formatDecimal(s.avgDiff, 4),
        formatDecimal(s.avgRange, 4),
        formatDecimal(s.avgVolume, 5),
        s.longestBullishStreak,
        s.longestBearishStreak,
      ].join(',')
    );
  }

  const scopeSlug =
    result.config.scope === 'ALL'
      ? 'all_timeframes'
      : result.config.scope.toLowerCase();

  triggerDownload(
    rows.join('\n'),
    `btc_candle_collector_${scopeSlug}_summary.csv`,
    'text/csv;charset=utf-8;'
  );
}

/**
 * Exports every individual historical occurrence of a single collected candle slot as CSV.
 */
export function downloadSingleSlotHistoryCsv(slot: CollectedCandleSlot): void {
  const csv = serializeEnrichedCandlesToCsv(slot.history);
  const safeSlot = slot.slotLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  triggerDownload(
    csv,
    `btc_${slot.timeframe.toLowerCase()}_${safeSlot}_history.csv`,
    'text/csv;charset=utf-8;'
  );
}

/**
 * Exports ranked Best Matched Candles results (Mode A Multi-TF or Mode B Single-File) as CSV.
 */
export function downloadBestMatchesCsv(
  result: BestMatchResult,
  filteredMatches: BestMatchItem[]
): void {
  const headers = [
    'Rank',
    'Anchor_Timeframe',
    'Start_Time_UTC',
    'End_Time_UTC',
    'Match_Score_Pct',
    'Directional_Score_Pct',
    'Structural_Score_Pct',
    'Volume_Score_Pct',
    'Dominant_Direction',
    'Pattern_Label',
    'Summary_Detail',
    'Candle_Breakdown',
  ];

  const rows: string[] = [headers.join(',')];

  filteredMatches.forEach((m, idx) => {
    const breakdown = m.snapshots
      .map(
        (s) =>
          `${s.roleLabel}[${s.candle.timeStr} O=${s.candle.open} H=${s.candle.high} L=${s.candle.low} C=${s.candle.close} Body=${(s.features.bodyRatio * 100).toFixed(0)}%]`
      )
      .join(' | ');

    rows.push(
      [
        idx + 1,
        m.anchorTimeframe,
        m.timeStr,
        m.endTimeStr,
        m.matchScore.toFixed(2),
        m.directionalScore.toFixed(2),
        m.structuralScore.toFixed(2),
        m.volumeScore !== null ? m.volumeScore.toFixed(2) : 'N/A',
        m.dominantDirection,
        escapeCsvCell(m.patternLabel),
        escapeCsvCell(m.summaryDetail),
        escapeCsvCell(breakdown),
      ].join(',')
    );
  });

  const scopeSlug =
    result.scope === 'multi_tf'
      ? `multi_${result.activeTimeframes.join('_').toLowerCase()}`
      : `single_${result.config.singleTimeframe.toLowerCase()}`;

  triggerDownload(
    rows.join('\n'),
    `btc_best_matches_${scopeSlug}.csv`,
    'text/csv;charset=utf-8;'
  );
}


