import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDecimal } from './csvParser';
import {
  AnalysisResult,
  BestMatchFilterState,
  BestMatchItem,
  BestMatchResult,
  CollectedCandleSlot,
  CollectorResult,
  IntradayFullMatrixAnchorSummary,
  IntradaySlotFilterState,
  IntradaySlotMatchItem,
  IntradaySlotMatchResult,
  PrincipalCandidateResult,
  ResultsFilterState,
  TimeframeDataset,
  TimeframeId,
} from './types';

function fmtPct(val: number | null): string {
  if (val === null) return '—';
  return `${val.toFixed(2)}%`;
}

/**
 * Generates a formatted multi-page institutional PDF report using jsPDF & jspdf-autotable.
 */
export function exportCorrelationReportPdf(
  result: AnalysisResult,
  filteredCandidates: PrincipalCandidateResult[],
  filters: ResultsFilterState,
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 36;

  // Header Banner
  doc.setFillColor(11, 15, 23);
  doc.rect(0, 0, pageWidth, 74, 'F');

  doc.setTextColor(245, 158, 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('INSTITUTIONAL CANDLE CORRELATION REPORT', marginX, 24);

  doc.setTextColor(248, 250, 252);
  doc.setFontSize(17);
  doc.text('BTC Multi-Timeframe Candle Correlation Analyzer', marginX, 46);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Generated (UTC): ${result.computedAtUtc}`, marginX, 62);
  doc.text(
    `Mode: ${result.config.mode === 'cross' ? 'Cross-Timeframe' : 'Same-Timeframe'}`,
    pageWidth - marginX,
    62,
    { align: 'right' }
  );

  let cursorY = 94;

  // Section 1: Analysis Parameters & KPI Summary
  const topCandidate = filteredCandidates[0] ?? null;

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Analysis Parameters & Executive Summary', marginX, cursorY);
  cursorY += 10;

  const dateRangeLabel =
    result.effectiveStartUtc && result.effectiveEndUtc
      ? `${result.effectiveStartUtc} to ${result.effectiveEndUtc} (UTC)`
      : 'N/A';

  const activeFiltersDesc = [
    `Min Alignment >= ${filters.minAlignmentPct}%`,
    `Min Sample N >= ${filters.minSampleSize}`,
    `Direction: ${filters.directionFilter.toUpperCase()}`,
    filters.beforeCloseOnly ? 'Before Target Close Only' : 'All Timing Relations',
  ].join(' | ');

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 6,
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    head: [['Metric', 'Value', 'Metric', 'Value']],
    body: [
      [
        'Target Candle',
        result.targetDescription,
        'Search Scope',
        result.searchDescription,
      ],
      [
        'Top Principal Candle',
        topCandidate
          ? `${topCandidate.slotLabel} (${topCandidate.overallAlignmentScore.toFixed(2)}%, N=${topCandidate.totalValidPairs})`
          : 'No matching candidates',
        'Analyzed UTC Range',
        dateRangeLabel,
      ],
      [
        'Valid Cycles Analyzed',
        `${result.totalValidCycles.toLocaleString()} (of ${result.totalCyclesScanned.toLocaleString()} scanned)`,
        'Excluded Dojis',
        `${result.totalExcludedDojiPairs.toLocaleString()} pairs (${result.totalExcludedTargetDojis.toLocaleString()} Target Dojis)`,
      ],
      [
        'Active Filters',
        activeFiltersDesc,
        'Ranked Slots Shown',
        `${filteredCandidates.length} of ${result.candidates.length}`,
      ],
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY + 110) + 20;

  // Section 2: Dataset Audit Verification Status
  const relevantTfs = Array.from(
    new Set([
      result.config.targetTimeframe,
      result.config.mode === 'cross' ? result.config.searchTimeframe : result.config.targetTimeframe,
    ])
  );
  const auditRows = relevantTfs
    .map((tf) => datasets[tf])
    .filter((ds): ds is TimeframeDataset => Boolean(ds))
    .map((ds) => [
      ds.timeframe,
      ds.fileName,
      ds.audit.totalCandles.toLocaleString(),
      ds.audit.bullishCount.toLocaleString(),
      ds.audit.bearishCount.toLocaleString(),
      ds.audit.dojiCount.toLocaleString(),
      ds.audit.auditStatus,
      ds.audit.autoFixedErrors.toLocaleString(),
      `${ds.startUtcStr ?? '—'} → ${ds.endUtcStr ?? '—'}`,
    ]);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('2. Dataset Verification & Double-Check Audit Status', marginX, cursorY);
  cursorY += 10;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 5,
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    head: [
      [
        'Timeframe',
        'Source File',
        'Total',
        'Bullish',
        'Bearish',
        'Doji',
        'Audit Status',
        'Auto-Fixed',
        'UTC Coverage',
      ],
    ],
    body: auditRows,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY + 80) + 22;

  // Section 3: Ranked Principal Candles Table
  if (cursorY > doc.internal.pageSize.getHeight() - 120) {
    doc.addPage();
    cursorY = 44;
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(
    `3. Ranked Principal Candles (${filteredCandidates.length} slots)`,
    marginX,
    cursorY
  );
  cursorY += 10;

  const tableRows = filteredCandidates.map((c, idx) => [
    `#${idx + 1}`,
    c.slotLabel,
    c.searchTimeframe,
    `${c.overallAlignmentScore.toFixed(2)}%`,
    c.bullishMatchRate !== null
      ? `${fmtPct(c.bullishMatchRate)} (${c.bullishMatches}/${c.targetBullishCount})`
      : '— (0/0)',
    c.bearishMatchRate !== null
      ? `${fmtPct(c.bearishMatchRate)} (${c.bearishMatches}/${c.targetBearishCount})`
      : '— (0/0)',
    c.totalValidPairs.toLocaleString(),
    c.excludedDojiPairs.toLocaleString(),
    `${c.timingRelation} · ${c.timingDetail}`,
  ]);

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'striped',
    styles: {
      fontSize: 8,
      cellPadding: 5,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.4,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 36 },
      3: { halign: 'right', fontStyle: 'bold' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
    head: [
      [
        'Rank',
        'Principal Candle Slot',
        'TF',
        'Overall Match',
        'Bullish Match (Hit/Tot)',
        'Bearish Match (Hit/Tot)',
        'Sample N',
        'Excl. Dojis',
        'Timing Relation',
      ],
    ],
    body:
      tableRows.length > 0
        ? tableRows
        : [['—', 'No candidate slots matched active filter thresholds', '—', '—', '—', '—', '0', '0', '—']],
    didDrawPage: (data) => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `BTC Multi-Timeframe Candle Correlation Analyzer · Deterministic UTC Audit Report`,
        marginX,
        pageHeight - 18
      );
      doc.text(
        `Page ${data.pageNumber}`,
        pageWidth - marginX,
        pageHeight - 18,
        { align: 'right' }
      );
    },
  });

  const targetSlug = result.config.targetTimeframe.toLowerCase();
  const searchSlug =
    result.config.mode === 'same'
      ? `${targetSlug}_same`
      : result.config.searchTimeframe.toLowerCase();
  const dateTag = (result.effectiveEndUtc || 'report').replace(/[^0-9-]/g, '');

  doc.save(`btc_correlation_report_${targetSlug}_vs_${searchSlug}_${dateTag}.pdf`);
}

/**
 * Generates a dark-header institutional PDF report for the Candle Data Collector summary table
 * and active filter parameters.
 */
export function exportCollectedSummaryPdf(
  result: CollectorResult,
  filteredSlots: CollectedCandleSlot[],
  activeFilters: {
    excludeDojiFromPct: boolean;
    minOccurrences: number;
    searchQuery: string;
  }
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 32;

  // Dark Institutional Header Banner
  doc.setFillColor(11, 15, 23);
  doc.rect(0, 0, pageWidth, 74, 'F');

  doc.setTextColor(245, 158, 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('CANDLE DATA COLLECTOR SUMMARY REPORT', marginX, 24);

  doc.setTextColor(248, 250, 252);
  doc.setFontSize(17);
  doc.text('BTC Multi-Timeframe Candle Correlation Analyzer', marginX, 46);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Generated (UTC): ${result.computedAtUtc}`, marginX, 62);
  doc.text(
    `Scope: ${result.config.scope === 'ALL' ? `All Uploaded (${result.timeframesCollected.join(', ')})` : result.config.scope}`,
    pageWidth - marginX,
    62,
    { align: 'right' }
  );

  let cursorY = 92;

  // Filter Parameters & Summary Strip
  const highConsistencyCount = filteredSlots.filter(
    (s) => s.validNonDojiCount > 0 && s.dominancePct >= 70
  ).length;
  const topSlot = filteredSlots.reduce<CollectedCandleSlot | null>((best, s) => {
    if (s.validNonDojiCount === 0) return best;
    if (!best) return s;
    if (s.dominancePct > best.dominancePct) return s;
    if (s.dominancePct === best.dominancePct && s.validNonDojiCount > best.validNonDojiCount) {
      return s;
    }
    return best;
  }, null);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Collection Scope & Active Filter Parameters', marginX, cursorY);
  cursorY += 10;

  const dateWindow =
    result.config.startDateUtc || result.config.endDateUtc
      ? `${result.config.startDateUtc || 'Start'} to ${result.config.endDateUtc || 'End'} (UTC)`
      : 'Full Available UTC History';

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 5.5,
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    head: [['Parameter', 'Value', 'Parameter', 'Value']],
    body: [
      [
        'Timeframes Collected',
        result.timeframesCollected.join(', ') || 'None',
        'Total Candles Scanned',
        result.totalCandlesScanned.toLocaleString(),
      ],
      [
        'UTC Date Range',
        dateWindow,
        'Exclude Dojis from %',
        activeFilters.excludeDojiFromPct ? 'Yes (Based on Valid Non-Doji)' : 'No (Based on Total N)',
      ],
      [
        'Min Occurrences (N)',
        `>= ${activeFilters.minOccurrences}`,
        'Search Filter',
        activeFilters.searchQuery.trim() || 'None',
      ],
      [
        'High Consistency (>=70%)',
        `${highConsistencyCount.toLocaleString()} of ${filteredSlots.length.toLocaleString()} shown slots`,
        'Top Consistency Slot',
        topSlot
          ? `${topSlot.displayLabel} (${topSlot.dominantDirection} ${topSlot.dominancePct.toFixed(1)}%, N=${topSlot.validNonDojiCount})`
          : '—',
      ],
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY + 110) + 18;

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(
    `2. Collected Candle Slot Metrics (${filteredSlots.length.toLocaleString()} rows)`,
    marginX,
    cursorY
  );
  cursorY += 10;

  const bodyRows = filteredSlots.map((s) => [
    s.timeframe,
    s.slotLabel,
    s.totalOccurrences.toLocaleString(),
    s.validNonDojiCount.toLocaleString(),
    `${s.bullishCount} (${s.bullishPct.toFixed(1)}%)`,
    `${s.bearishCount} (${s.bearishPct.toFixed(1)}%)`,
    `${s.dojiCount} (${s.dojiPct.toFixed(1)}%)`,
    s.dominantDirection === 'NEUTRAL'
      ? '—'
      : `${s.dominantDirection} ${s.dominancePct.toFixed(1)}%`,
    formatDecimal(s.avgDiff, 2),
    formatDecimal(s.avgRange, 2),
    formatDecimal(s.avgVolume, 4),
    `${s.longestBullishStreak} / ${s.longestBearishStreak}`,
  ]);

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'striped',
    styles: {
      fontSize: 7.5,
      cellPadding: 4.5,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.4,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right' },
      11: { halign: 'center' },
    },
    head: [
      [
        'TF',
        'Candle Slot',
        'Total N',
        'Non-Doji',
        'Bullish',
        'Bearish',
        'Doji',
        'Dominance',
        'Avg Diff',
        'Avg Range',
        'Avg Vol',
        'Streaks (B/S)',
      ],
    ],
    body:
      bodyRows.length > 0
        ? bodyRows
        : [['—', 'No collected candle slots matched active filters', '0', '0', '—', '—', '—', '—', '—', '—', '—', '—']],
    didDrawPage: (data) => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'BTC Multi-Timeframe Candle Correlation Analyzer · Candle Data Collector Report',
        marginX,
        pageHeight - 18
      );
      doc.text(`Page ${data.pageNumber}`, pageWidth - marginX, pageHeight - 18, {
        align: 'right',
      });
    },
  });

  const scopeSlug =
    result.config.scope === 'ALL'
      ? 'all_timeframes'
      : result.config.scope.toLowerCase();

  doc.save(`btc_candle_collector_${scopeSlug}_report.pdf`);
}

/**
 * Generates a formatted institutional PDF report for Best Matched Candles Search results.
 */
export function exportBestMatchesReportPdf(
  result: BestMatchResult,
  filteredMatches: BestMatchItem[],
  filters: BestMatchFilterState
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 34;

  // Header Banner
  doc.setFillColor(11, 15, 23);
  doc.rect(0, 0, pageWidth, 74, 'F');

  doc.setTextColor(245, 158, 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('BEST MATCHED CANDLES SEARCH REPORT', marginX, 24);

  doc.setTextColor(248, 250, 252);
  doc.setFontSize(17);
  doc.text('BTC Multi-Timeframe Candle Correlation Analyzer', marginX, 46);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Generated (UTC): ${result.computedAtUtc}`, marginX, 62);
  doc.text(
    result.scope === 'multi_tf'
      ? `Mode: Cross-Timeframe (${result.activeTimeframes.join(' + ')})`
      : `Mode: Single-File (${result.config.singleTimeframe} · ${result.config.singleSubMode === 'reference' ? `Ref K=${result.config.sequenceLength}` : `Auto-Scan K=${result.config.sequenceLength}`})`,
    pageWidth - marginX,
    62,
    { align: 'right' }
  );

  let cursorY = 92;
  const topMatch = filteredMatches[0] ?? null;

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Search Scope & Executive Summary', marginX, cursorY);
  cursorY += 10;

  const dateRange =
    result.effectiveStartUtc && result.effectiveEndUtc
      ? `${result.effectiveStartUtc} to ${result.effectiveEndUtc} (UTC)`
      : 'Full Available UTC Range';

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 5.5,
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    head: [['Parameter', 'Value', 'Parameter', 'Value']],
    body: [
      [
        'Active Timeframes',
        result.activeTimeframes.join(', ') || 'None',
        'Candidates Scanned',
        result.totalCandidatesScanned.toLocaleString(),
      ],
      [
        'Top Ranked Match',
        topMatch
          ? `${topMatch.timeStr} (${topMatch.matchScore.toFixed(2)}% · ${topMatch.patternLabel})`
          : 'No matches above threshold',
        'UTC Coverage',
        dateRange,
      ],
      [
        'Min Match Score Filter',
        `>= ${Math.max(result.config.minMatchScore, filters.minScoreOverride)}%`,
        'Matches Shown',
        `${filteredMatches.length} of ${result.totalAboveThreshold.toLocaleString()} qualifying`,
      ],
      [
        'Execution Mode',
        result.usedWorker ? 'Web Worker (Off-Thread)' : 'Direct Deterministic Engine',
        'Compute Duration',
        `${result.computeDurationMs.toFixed(1)} ms`,
      ],
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY + 110) + 18;

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`2. Ranked Best Matched Candles (${filteredMatches.length} results)`, marginX, cursorY);
  cursorY += 10;

  const bodyRows = filteredMatches.map((m, idx) => [
    `#${idx + 1}`,
    m.timeStr,
    m.anchorTimeframe,
    `${m.matchScore.toFixed(2)}%`,
    `${m.directionalScore.toFixed(1)}%`,
    `${m.structuralScore.toFixed(1)}%`,
    m.volumeScore !== null ? `${m.volumeScore.toFixed(1)}%` : '—',
    m.dominantDirection,
    m.patternLabel,
    m.snapshots
      .map((s) => `${s.roleLabel}: ${s.candle.candleType} (O ${s.candle.open} -> C ${s.candle.close})`)
      .join(' | '),
  ]);

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'striped',
    styles: {
      fontSize: 7.5,
      cellPadding: 4.5,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.4,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 32 },
      3: { halign: 'right', fontStyle: 'bold' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
    head: [
      [
        'Rank',
        'Start Time (UTC)',
        'Anchor',
        'Match %',
        'Dir %',
        'Struct %',
        'Vol %',
        'Direction',
        'Setup / Pattern',
        'Candle Snapshots',
      ],
    ],
    body:
      bodyRows.length > 0
        ? bodyRows
        : [['—', 'No matched candles meet current thresholds', '—', '—', '—', '—', '—', '—', '—', '—']],
    didDrawPage: (data) => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'BTC Multi-Timeframe Candle Correlation Analyzer · Best Matched Candles Report',
        marginX,
        pageHeight - 18
      );
      doc.text(`Page ${data.pageNumber}`, pageWidth - marginX, pageHeight - 18, {
        align: 'right',
      });
    },
  });

  const scopeSlug =
    result.scope === 'multi_tf'
      ? `multi_${result.activeTimeframes.join('_').toLowerCase()}`
      : `single_${result.config.singleTimeframe.toLowerCase()}`;

  doc.save(`btc_best_matches_${scopeSlug}.pdf`);
}

/**
 * Generates an institutional PDF report for Intraday Time-Slot Direction Correlation
 * (both Single-Anchor Ranked Table and Full-Matrix All-Slots Leaderboard).
 */
export function exportIntradaySlotReportPdf(
  result: IntradaySlotMatchResult,
  filteredMatches: IntradaySlotMatchItem[],
  filteredSummaries: IntradayFullMatrixAnchorSummary[],
  filters: IntradaySlotFilterState
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 34;

  // Header Banner
  doc.setFillColor(11, 15, 23);
  doc.rect(0, 0, pageWidth, 74, 'F');

  doc.setTextColor(245, 158, 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(
    result.scopeMode === 'single_anchor'
      ? 'DAILY INTRADAY TIME-SLOT DIRECTION CORRELATION REPORT'
      : 'FULL-MATRIX INTRADAY TIME-SLOT COLLECTION REPORT',
    marginX,
    24
  );

  doc.setTextColor(248, 250, 252);
  doc.setFontSize(17);
  doc.text('BTC Multi-Timeframe Candle Correlation Analyzer', marginX, 46);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Generated (UTC): ${result.computedAtUtc}`, marginX, 62);
  doc.text(
    result.scopeMode === 'single_anchor'
      ? `Anchor: ${result.anchorTimeframe} ${result.anchorSlotKey} UTC → Targets: ${result.targetTimeframes.join(', ')}`
      : `Full Matrix: ${result.anchorTimeframe} (All Slots) → Targets: ${result.targetTimeframes.join(', ')}`,
    pageWidth - marginX,
    62,
    { align: 'right' }
  );

  let cursorY = 92;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Correlation Parameters & Summary', marginX, cursorY);
  cursorY += 10;

  const dateRange =
    result.effectiveStartUtc && result.effectiveEndUtc
      ? `${result.effectiveStartUtc} → ${result.effectiveEndUtc}`
      : 'Full Available Overlap';

  const topSingle = filteredMatches[0] ?? null;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 5,
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    head: [['Parameter', 'Value', 'Summary Metric', 'Value']],
    body: [
      [
        'Execution Scope',
        result.scopeMode === 'single_anchor'
          ? `Single Anchor (${result.anchorTimeframe} ${result.anchorSlotKey} UTC)`
          : `Full-Matrix (${result.totalAnchorSlotsEvaluated} Anchor Slots)`,
        'Valid Days Evaluated',
        result.totalValidDaysEvaluated.toLocaleString(),
      ],
      [
        'Target Timeframes',
        result.targetTimeframes.join(', '),
        'Pairwise Slots Evaluated',
        result.totalPairwiseEvaluations.toLocaleString(),
      ],
      [
        'Direction Filter & Thresholds',
        `${result.config.directionFilter} · Min ${result.config.minCoOccurringDays} days · ≥${result.config.minMatchRatePct}%`,
        result.scopeMode === 'single_anchor' ? '#1 Top Matched Slot' : 'Anchor Slots Exported',
        result.scopeMode === 'single_anchor'
          ? topSingle
            ? `${topSingle.targetTimeframe} ${topSingle.targetSlotKey} (${topSingle.matchRatePct.toFixed(2)}%, ${topSingle.matchedDays}/${topSingle.totalCoOccurringDays})`
            : 'None'
          : `${filteredSummaries.length} slots`,
      ],
      [
        'Effective UTC Date Range',
        dateRange,
        'Dashboard Filter Query',
        filters.searchQuery || 'None',
      ],
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY + 90) + 20;

  if (result.scopeMode === 'single_anchor') {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(
      `2. Ranked Intraday Time-Slot Matches (${filteredMatches.length} rows)`,
      marginX,
      cursorY
    );
    cursorY += 10;

    const bodyRows = filteredMatches.map((m, idx) => [
      `#${idx + 1}`,
      m.targetTimeframe,
      `${m.targetSlotKey} UTC`,
      `${m.matchedDays} / ${m.totalCoOccurringDays}`,
      `${m.matchRatePct.toFixed(2)}%`,
      `${m.bullishMatches}`,
      `${m.bearishMatches}`,
      m.dayRecords
        .filter((r) => r.isMatch)
        .slice(0, 6)
        .map((r) => r.dateStr)
        .join(', ') || '—',
    ]);

    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      theme: 'striped',
      styles: {
        fontSize: 7.8,
        cellPadding: 4.5,
        textColor: [15, 23, 42],
        lineColor: [226, 232, 240],
        lineWidth: 0.4,
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [248, 250, 252],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 32 },
        3: { halign: 'right' },
        4: { halign: 'right', fontStyle: 'bold' },
        5: { halign: 'right' },
        6: { halign: 'right' },
      },
      head: [
        [
          'Rank',
          'Target TF',
          'Target Slot',
          'Matched / Total Days',
          'Match Rate %',
          'Bullish Matches',
          'Bearish Matches',
          'Recent Matched Dates (UTC)',
        ],
      ],
      body:
        bodyRows.length > 0
          ? bodyRows
          : [['—', '—', 'No matching slots met current thresholds', '—', '—', '—', '—', '—']],
      didDrawPage: (data) => {
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(
          'BTC Multi-Timeframe Candle Correlation Analyzer · Intraday Time-Slot Match Report',
          marginX,
          pageHeight - 18
        );
        doc.text(`Page ${data.pageNumber}`, pageWidth - marginX, pageHeight - 18, {
          align: 'right',
        });
      },
    });

    const slotSlug = (result.anchorSlotKey || 'slot').replace(/:/g, '');
    doc.save(`btc_intraday_match_${result.anchorTimeframe.toLowerCase()}_${slotSlug}.pdf`);
  } else {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(
      `2. Master Intraday Slot Matrix (${filteredSummaries.length} anchor slots)`,
      marginX,
      cursorY
    );
    cursorY += 10;

    const bodyRows = filteredSummaries.map((row) => {
      const b = row.bestTarget;
      return [
        `${row.anchorSlotKey} UTC`,
        row.totalValidAnchorDays.toLocaleString(),
        b ? `${b.targetTimeframe} ${b.targetSlotKey} UTC` : 'No qualifying target',
        b ? `${b.matchedDays} / ${b.totalCoOccurringDays}` : '—',
        b ? `${b.matchRatePct.toFixed(2)}%` : '0.00%',
        `${row.top5AvgMatchRatePct.toFixed(1)}%`,
        row.topTargets
          .slice(0, 3)
          .map((t) => `${t.targetTimeframe} ${t.targetSlotKey} (${t.matchRatePct.toFixed(0)}%)`)
          .join(' · ') || '—',
      ];
    });

    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      theme: 'striped',
      styles: {
        fontSize: 7.5,
        cellPadding: 4,
        textColor: [15, 23, 42],
        lineColor: [226, 232, 240],
        lineWidth: 0.4,
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [248, 250, 252],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        1: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right', fontStyle: 'bold' },
        5: { halign: 'right' },
      },
      head: [
        [
          'Anchor Slot',
          'Valid Days',
          '#1 Best Matched Slot',
          'Matched / Total',
          'Match Rate %',
          'Top-5 Avg %',
          'Top 3 Correlated Slots',
        ],
      ],
      body:
        bodyRows.length > 0
          ? bodyRows
          : [['—', '—', 'No anchor slots matched current filters', '—', '—', '—', '—']],
      didDrawPage: (data) => {
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(
          'BTC Multi-Timeframe Candle Correlation Analyzer · Full-Matrix Intraday Report',
          marginX,
          pageHeight - 18
        );
        doc.text(`Page ${data.pageNumber}`, pageWidth - marginX, pageHeight - 18, {
          align: 'right',
        });
      },
    });

    doc.save(`btc_intraday_full_matrix_${result.anchorTimeframe.toLowerCase()}.pdf`);
  }
}



