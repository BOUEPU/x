import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSafeDiff,
  parseCsvText,
  parseStrictUtcTimestamp,
  serializeEnrichedCandlesToCsv,
} from './csvParser';
import { classifyAndAuditCandles, runIndependentAuditPass } from './audit';
import {
  buildTargetConfigFromCollectedSlot,
  collectCandleData,
  DEFAULT_COLLECTOR_GROUPING,
  filterCollectedSlots,
  getIsoWeekNumberUtc,
} from './collector';
import {
  computeDatasetFeatures,
  filterAndRankBestMatches,
  filterAndRankCandidates,
  filterAndRankIntradayMatches,
  getLoadedTimeframeIds,
  runBestMatchedCandlesSearch,
  runCorrelationAnalysis,
  runIntradaySlotMatchSearch,
} from './correlation';
import {
  AnalysisConfig,
  BestMatchConfig,
  EnrichedCandle,
  IntradaySlotMatchConfig,
  TimeframeDataset,
  TimeframeId,
} from './types';

function buildDataset(tf: TimeframeId, csvText: string): TimeframeDataset {
  const core = parseCsvText(csvText);
  const { candles, summary } = classifyAndAuditCandles(core.rawCandles);
  return {
    timeframe: tf,
    fileName: `btc_${tf}.csv`,
    fileSizeBytes: csvText.length,
    status: 'verified',
    candles,
    rowCount: candles.length,
    duplicateCount: core.duplicateCount,
    malformedRows: core.malformedRows,
    malformedCount: core.malformedCount,
    startUtcMs: candles[0]?.timestamp ?? null,
    endUtcMs: candles[candles.length - 1]?.timestamp ?? null,
    startUtcStr: candles[0]?.timeStr ?? null,
    endUtcStr: candles[candles.length - 1]?.timeStr ?? null,
    audit: summary,
    headersDetected: core.headersDetected,
  };
}

test('strict UTC timestamp parsing handles YYYY.MM.DD HH:MM:SS and rejects invalid dates', () => {
  const ok = parseStrictUtcTimestamp('2021.01.01 22:00:00');
  assert.ok(ok);
  assert.equal(ok.timestamp, Date.UTC(2021, 0, 1, 22, 0, 0));
  assert.equal(ok.canonical, '2021.01.01 22:00:00');

  // Reject impossible calendar date Feb 30
  assert.equal(parseStrictUtcTimestamp('2021.02.30 00:00:00'), null);
  // Reject dash-separated non-conforming timestamp
  assert.equal(parseStrictUtcTimestamp('2021-01-01 22:00:00'), null);
});

test('CSV parser handles trailing Volume space, CRLF, empty lines, duplicates, unsorted rows, and malformed rows', () => {
  const csv = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2021.01.01 22:02:00,29191.7,29205.5,29189.1,29205.5,0.00053',
    '',
    '2021.01.01 22:00:00,29222.5,29224.3,29176.1,29181.6,0.004',
    '2021.01.01 22:00:00,29222.5,29224.3,29176.1,29181.6,0.004', // exact duplicate
    'BAD_DATE,100,110,90,105,1.0', // malformed
    '2021.01.01 22:01:00,29181.6,29197.5,29180.4,29191.7,0.00241',
  ].join('\r\n');

  const res = parseCsvText(csv);
  assert.deepEqual(res.headersDetected, ['Time (UTC)', 'Open', 'High', 'Low', 'Close', 'Volume']);
  assert.equal(res.rawCandles.length, 3);
  assert.equal(res.duplicateCount, 1);
  assert.equal(res.malformedCount, 1);
  // Chronological ascending order verified
  assert.equal(res.rawCandles[0].timeStr, '2021.01.01 22:00:00');
  assert.equal(res.rawCandles[1].timeStr, '2021.01.01 22:01:00');
  assert.equal(res.rawCandles[2].timeStr, '2021.01.01 22:02:00');
});

test('precision-safe diff eliminates floating point drift and audit pass auto-fixes corrupted classifications', () => {
  // Classic JS IEEE-754 float trap: 0.3 - 0.1 = 0.19999999999999998; 29181.6 - 29222.5 = -40.89999999999782
  assert.equal(computeSafeDiff(29222.5, 29181.6), -40.9);
  assert.equal(computeSafeDiff(0.1, 0.3), 0.2);
  assert.equal(computeSafeDiff(30000.12345678, 30000.12345678), 0);

  // Inject deliberately corrupted candle into independent audit pass
  const corrupted: EnrichedCandle[] = [
    {
      timestamp: Date.UTC(2021, 0, 1, 0, 0, 0),
      timeStr: '2021.01.01 00:00:00',
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1,
      diff: -5, // intentionally wrong
      candleType: 'BEARISH', // intentionally wrong
    },
    {
      timestamp: Date.UTC(2021, 0, 2, 0, 0, 0),
      timeStr: '2021.01.02 00:00:00',
      open: 105,
      high: 106,
      low: 104,
      close: 105,
      volume: 1,
      diff: 0,
      candleType: 'DOJI',
    },
  ];

  const auditRes = runIndependentAuditPass(corrupted);
  assert.equal(auditRes.summary.auditStatus, '100% Verified');
  assert.equal(auditRes.summary.autoFixedErrors, 1);
  assert.equal(auditRes.summary.bullishCount, 1);
  assert.equal(auditRes.summary.dojiCount, 1);
  assert.equal(auditRes.candles[0].diff, 5);
  assert.equal(auditRes.candles[0].candleType, 'BULLISH');

  const csvOut = serializeEnrichedCandlesToCsv(auditRes.candles);
  assert.ok(csvOut.includes('Time (UTC),Open,High,Low,Close,Volume,Diff,Candle_Type'));
  assert.ok(csvOut.includes('2021.01.01 00:00:00,100,110,95,105,1,5,BULLISH'));
});

test('cross-timeframe correlation handles partial first day, strictly excludes Dojis, ranks by score & N, and labels timing', () => {
  const dailyCsv = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2021.01.01 00:00:00,100,120,90,110,1', // BULLISH (partial day in 1H: only 22:00 & 23:00 exist)
    '2021.01.02 00:00:00,110,115,95,100,1', // BEARISH
    '2021.01.03 00:00:00,100,105,95,100,1', // DOJI (must be strictly excluded)
    '2021.01.04 00:00:00,100,130,98,125,1', // BULLISH
  ].join('\n');

  const hourlyCsv = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    // Day 1 (Target BULLISH) — starts at 22:00 (partial day)
    '2021.01.01 22:00:00,100,110,99,105,1', // BULLISH -> match (BEFORE)
    '2021.01.01 23:00:00,105,112,104,110,1', // BULLISH -> match (INSIDE: closes with 1D)
    // Day 2 (Target BEARISH)
    '2021.01.02 08:00:00,110,111,100,102,1', // BEARISH -> match (BEFORE)
    '2021.01.02 22:00:00,105,106,99,100,1', // BEARISH -> match (BEFORE)
    '2021.01.02 23:00:00,100,104,99,103,1', // BULLISH -> mismatch (INSIDE)
    // Day 3 (Target DOJI -> excluded for all slots!)
    '2021.01.03 08:00:00,100,105,99,104,1',
    '2021.01.03 22:00:00,100,105,99,104,1',
    // Day 4 (Target BULLISH)
    '2021.01.04 08:00:00,100,115,99,112,1', // BULLISH -> match
    '2021.01.04 22:00:00,115,120,114,120,1', // BULLISH -> match
    '2021.01.04 23:00:00,120,120,120,120,1', // DOJI principal -> excluded!
  ].join('\n');

  const ds1D = buildDataset('1D', dailyCsv);
  const ds1H = buildDataset('1H', hourlyCsv);

  const config: AnalysisConfig = {
    mode: 'cross',
    targetTimeframe: '1D',
    searchTimeframe: '1H',
    crossStrategy: 'parent_window',
    sameStrategy: 'specific_slot',
    targetSlotKey: null,
    maxLagCandles: 12,
    includeLeadOffsets: false,
    startDateUtc: '',
    endDateUtc: '',
  };

  const result = runCorrelationAnalysis({ '1D': ds1D, '1H': ds1H }, config);
  assert.equal(result.warningMessage, null);
  assert.equal(result.totalValidCycles, 3);
  assert.equal(result.totalExcludedTargetDojis, 1);

  // 22:00 UTC has 100% alignment with N=3 (Days 1, 2, 4), 1 Doji excluded (Day 3) -> Rank #1
  // 08:00 UTC has 100% alignment with N=2 (Days 2, 4), 1 Doji excluded (Day 3) -> Rank #2 (tie-break by N)
  // 23:00 UTC has 50% alignment with N=2 (Day 1 match, Day 2 mismatch; Day 4 principal Doji excluded) -> Rank #3
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].slotLabel, '22:00 UTC');
  assert.equal(result.candidates[0].overallAlignmentScore, 100);
  assert.equal(result.candidates[0].totalValidPairs, 3);
  assert.equal(result.candidates[0].excludedDojiPairs, 1);
  assert.equal(result.candidates[0].timingRelation, 'BEFORE');

  assert.equal(result.candidates[1].slotLabel, '08:00 UTC');
  assert.equal(result.candidates[1].overallAlignmentScore, 100);
  assert.equal(result.candidates[1].totalValidPairs, 2);
  assert.equal(result.candidates[1].timingRelation, 'BEFORE');

  assert.equal(result.candidates[2].slotLabel, '23:00 UTC');
  assert.equal(result.candidates[2].overallAlignmentScore, 50);
  assert.equal(result.candidates[2].totalValidPairs, 2);
  assert.equal(result.candidates[2].excludedDojiPairs, 1);
  assert.equal(result.candidates[2].timingRelation, 'INSIDE');

  // Verify beforeCloseOnly filter drops 23:00 UTC (INSIDE)
  const leadingOnly = filterAndRankCandidates(result.candidates, {
    searchQuery: '',
    minAlignmentPct: 0,
    minSampleSize: 1,
    directionFilter: 'both',
    beforeCloseOnly: true,
    startDateUtc: '',
    endDateUtc: '',
  });
  assert.equal(leadingOnly.length, 2);
});

test('same-timeframe mode supports both specific slot and relative lag offsets', () => {
  const hourlyCsv = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2021.01.01 10:00:00,100,110,99,108,1', // BULL
    '2021.01.01 11:00:00,108,112,107,111,1', // BULL
    '2021.01.01 12:00:00,111,115,110,114,1', // BULL
    '2021.01.02 10:00:00,114,115,105,106,1', // BEAR
    '2021.01.02 11:00:00,106,107,100,101,1', // BEAR
    '2021.01.02 12:00:00,101,105,100,104,1', // BULL
  ].join('\n');

  const ds1H = buildDataset('1H', hourlyCsv);

  // Specific slot: Target = 11:00 UTC -> compare 10:00 UTC (BEFORE) and 12:00 UTC (AFTER)
  const slotRes = runCorrelationAnalysis(
    { '1H': ds1H },
    {
      mode: 'same',
      targetTimeframe: '1H',
      searchTimeframe: '1H',
      crossStrategy: 'parent_window',
      sameStrategy: 'specific_slot',
      targetSlotKey: '11:00',
      maxLagCandles: 4,
      includeLeadOffsets: false,
      startDateUtc: '',
      endDateUtc: '',
    }
  );

  assert.equal(slotRes.candidates.length, 2);
  assert.equal(slotRes.candidates[0].slotLabel, '10:00 UTC');
  assert.equal(slotRes.candidates[0].overallAlignmentScore, 100);
  assert.equal(slotRes.candidates[0].timingRelation, 'BEFORE');
  assert.equal(slotRes.candidates[1].slotLabel, '12:00 UTC');
  assert.equal(slotRes.candidates[1].overallAlignmentScore, 50);
  assert.equal(slotRes.candidates[1].timingRelation, 'AFTER');

  // Relative lag offset
  const lagRes = runCorrelationAnalysis(
    { '1H': ds1H },
    {
      mode: 'same',
      targetTimeframe: '1H',
      searchTimeframe: '1H',
      crossStrategy: 'parent_window',
      sameStrategy: 'relative_offset',
      targetSlotKey: '__ALL__',
      maxLagCandles: 2,
      includeLeadOffsets: false,
      startDateUtc: '',
      endDateUtc: '',
    }
  );
  assert.equal(lagRes.candidates.length, 2);
  assert.ok(lagRes.candidates.every((c) => c.timingRelation === 'BEFORE'));
});

test('non-overlapping date ranges and all-Doji datasets return clean warnings without NaN or crashes', () => {
  const ds1D = buildDataset(
    '1D',
    [
      'Time (UTC),Open,High,Low,Close,Volume ',
      '2021.01.01 00:00:00,100,100,100,100,1',
    ].join('\n')
  );
  const ds1H = buildDataset(
    '1H',
    [
      'Time (UTC),Open,High,Low,Close,Volume ',
      '2022.05.01 00:00:00,200,210,190,205,1',
    ].join('\n')
  );

  const nonOverlap = runCorrelationAnalysis(
    { '1D': ds1D, '1H': ds1H },
    {
      mode: 'cross',
      targetTimeframe: '1D',
      searchTimeframe: '1H',
      crossStrategy: 'parent_window',
      sameStrategy: 'specific_slot',
      targetSlotKey: null,
      maxLagCandles: 12,
      includeLeadOffsets: false,
      startDateUtc: '',
      endDateUtc: '',
    }
  );
  assert.ok(nonOverlap.warningMessage?.includes('Non-overlapping'));
  assert.equal(nonOverlap.candidates.length, 0);

  // All-Doji overlapping test (zero division check)
  const ds1HDoji = buildDataset(
    '1H',
    [
      'Time (UTC),Open,High,Low,Close,Volume ',
      '2021.01.01 00:00:00,100,105,95,100,1',
    ].join('\n')
  );
  const allDoji = runCorrelationAnalysis(
    { '1D': ds1D, '1H': ds1HDoji },
    {
      mode: 'cross',
      targetTimeframe: '1D',
      searchTimeframe: '1H',
      crossStrategy: 'parent_window',
      sameStrategy: 'specific_slot',
      targetSlotKey: null,
      maxLagCandles: 12,
      includeLeadOffsets: false,
      startDateUtc: '',
      endDateUtc: '',
    }
  );
  assert.ok(allDoji.warningMessage?.includes('DOJI'));
  assert.equal(allDoji.candidates[0].overallAlignmentScore, 0);
  assert.equal(allDoji.candidates[0].bullishMatchRate, null);
  assert.equal(allDoji.candidates[0].bearishMatchRate, null);
});

test('candle data collector computes exact metrics, streaks, Doji toggle, and preserves full history array', () => {
  const hourlyCsv = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    // 14:00 UTC occurrences: BULL, BULL, DOJI, BULL, BEAR -> N=5, Valid=4, Bull=3 (75% excl Doji, 60% incl Doji), Bear=1 (25%), Max Bull Streak=2, Max Bear Streak=1
    '2021.01.04 14:00:00,100,120,90,110,2.0',   // Mon BULL diff=+10, range=30
    '2021.01.05 14:00:00,110,130,105,120,4.0',  // Tue BULL diff=+10, range=25
    '2021.01.06 14:00:00,120,125,115,120,1.0',  // Wed DOJI diff=0, range=10 (breaks streak)
    '2021.01.07 14:00:00,120,140,118,135,3.0',  // Thu BULL diff=+15, range=22
    '2021.01.08 14:00:00,135,140,120,125,5.0',  // Fri BEAR diff=-10, range=20
    // 15:00 UTC all-Doji slot -> must return 0.0% without NaN
    '2021.01.04 15:00:00,100,105,95,100,1.0',
  ].join('\n');

  const ds1H = buildDataset('1H', hourlyCsv);

  const res = collectCandleData(
    { '1H': ds1H },
    {
      scope: '1H',
      grouping: DEFAULT_COLLECTOR_GROUPING,
      startDateUtc: '',
      endDateUtc: '',
      excludeDojiFromPct: true,
      minOccurrences: 1,
    }
  );

  assert.equal(res.totalCandlesScanned, 6);
  assert.equal(res.slots.length, 2);

  const slot14 = res.slots.find((s) => s.slotKey === '14:00')!;
  assert.ok(slot14);
  assert.equal(slot14.displayLabel, '1H — 14:00 UTC');
  assert.equal(slot14.totalOccurrences, 5);
  assert.equal(slot14.validNonDojiCount, 4);
  assert.equal(slot14.bullishCount, 3);
  assert.equal(slot14.bullishPct, 75);
  assert.equal(slot14.bearishCount, 1);
  assert.equal(slot14.bearishPct, 25);
  assert.equal(slot14.dojiCount, 1);
  assert.equal(slot14.dojiPct, 20);
  assert.equal(slot14.dominantDirection, 'BULLISH');
  assert.equal(slot14.dominancePct, 75);
  assert.equal(slot14.avgDiff, 5); // (10 + 10 + 0 + 15 - 10) / 5 = 5
  assert.equal(slot14.avgRange, 21.4); // (30 + 25 + 10 + 22 + 20) / 5 = 21.4
  assert.equal(slot14.avgVolume, 3); // (2 + 4 + 1 + 3 + 5) / 5 = 3
  assert.equal(slot14.longestBullishStreak, 2);
  assert.equal(slot14.longestBearishStreak, 1);
  assert.equal(slot14.history.length, 5);

  // Toggling excludeDojiFromPct OFF recomputes percentages over Total N=5
  const inclDoji = filterCollectedSlots(res.slots, {
    excludeDojiFromPct: false,
    minOccurrences: 1,
    searchQuery: '14:00',
  });
  assert.equal(inclDoji.length, 1);
  assert.equal(inclDoji[0].bullishPct, 60);
  assert.equal(inclDoji[0].bearishPct, 20);

  // All-Doji slot returns 0.0% instead of NaN
  const slot15 = res.slots.find((s) => s.slotKey === '15:00')!;
  assert.equal(slot15.validNonDojiCount, 0);
  assert.equal(slot15.bullishPct, 0);
  assert.equal(slot15.bearishPct, 0);
  assert.equal(slot15.dominancePct, 0);
  assert.equal(slot15.dominantDirection, 'NEUTRAL');
});

test('candle data collector supports ALL-timeframe collection, DOW/ISO-Week/Month groupings, and Use-as-Target prefill', () => {
  const dailyCsv = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2021.01.04 00:00:00,100,110,95,108,1', // Monday
    '2021.01.11 00:00:00,108,120,100,118,2', // Monday
  ].join('\n');

  const weeklyCsv = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2021.01.04 00:00:00,100,120,95,115,5', // ISO Week 1
  ].join('\n');

  const ds1D = buildDataset('1D', dailyCsv);
  const ds1W = buildDataset('1W', weeklyCsv);

  assert.equal(getIsoWeekNumberUtc(Date.UTC(2021, 0, 4, 0, 0, 0)), 1);

  const allRes = collectCandleData(
    { '1D': ds1D, '1W': ds1W },
    {
      scope: 'ALL',
      grouping: {
        intraday: 'dow_utc_time',
        daily: 'day_of_week',
        weekly: 'iso_week',
        monthly: 'month_of_year',
      },
      startDateUtc: '',
      endDateUtc: '',
      excludeDojiFromPct: true,
      minOccurrences: 1,
    }
  );

  assert.deepEqual(allRes.timeframesCollected, ['1D', '1W']);
  assert.equal(allRes.slots.length, 2);

  const monSlot = allRes.slots.find((s) => s.timeframe === '1D')!;
  assert.equal(monSlot.slotLabel, 'Monday');
  assert.equal(monSlot.slotKey, 'DOW_0');
  assert.equal(monSlot.longestBullishStreak, 2);

  const wkSlot = allRes.slots.find((s) => s.timeframe === '1W')!;
  assert.equal(wkSlot.slotLabel, 'ISO Week 1');

  // Verify Use as Target Candle maps cleanly to AnalysisConfig
  const targetCfg = buildTargetConfigFromCollectedSlot(monSlot, { '1D': ds1D, '1W': ds1W });
  assert.equal(targetCfg.targetTimeframe, '1D');
  assert.equal(targetCfg.targetSlotKey, 'DOW_0');
});

test('Mode A Multi-Timeframe Best Match search aligns 2 and 3 timeframes under lowest_tf and parent_window anchors', () => {
  // Build 4H, 1H, 15MIN where 00:00 window has strong aligned bullish candles, while 04:00 conflicts
  const csv4H = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2021.01.01 00:00:00,100,122,99,120,10', // strong bullish
    '2021.01.01 04:00:00,120,122,100,102,10', // strong bearish
  ].join('\n');

  const csv1H = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2021.01.01 00:00:00,100,111,99,110,4',   // strong bullish
    '2021.01.01 03:00:00,110,121,109,120,5',  // strong bullish closing 4H window
    '2021.01.01 04:00:00,120,125,119,124,4',  // bullish (conflicts with 4H bearish!)
    '2021.01.01 07:00:00,102,112,101,111,4',  // bullish closing 4H window (conflicts with 4H bearish!)
  ].join('\n');

  const csv15M = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2021.01.01 03:45:00,115,121,114,120,2', // strong bullish inside 03:00 1H & 00:00 4H
    '2021.01.01 07:45:00,109,112,108,111,2', // bullish inside 07:00 1H & 04:00 4H
  ].join('\n');

  const ds4H = buildDataset('4H', csv4H);
  const ds1H = buildDataset('1H', csv1H);
  const ds15M = buildDataset('15MIN', csv15M);

  const loaded = getLoadedTimeframeIds({ '4H': ds4H, '1H': ds1H, '15MIN': ds15M });
  assert.deepEqual(loaded, ['15MIN', '1H', '4H']);

  // Lowest TF anchor across 3 timeframes
  const cfgLowest: BestMatchConfig = {
    scope: 'multi_tf',
    selectedTimeframes: ['15MIN', '1H', '4H'],
    multiTfAnchor: 'lowest_tf',
    singleTimeframe: '1H',
    singleSubMode: 'reference',
    sequenceLength: 1,
    referenceTimestamp: null,
    includeVolumeWeight: false,
    minMatchScore: 50,
    maxResults: 10,
    startDateUtc: '',
    endDateUtc: '',
  };
  const resLowest = runBestMatchedCandlesSearch(
    { '15MIN': ds15M, '1H': ds1H, '4H': ds4H },
    cfgLowest
  );
  assert.equal(resLowest.totalCandidatesScanned, 2);
  assert.ok(resLowest.matches.length >= 1);
  // 03:45 aligns with 03:00 1H & 00:00 4H (all 3 strong bullish) -> Rank #1 > 90%
  assert.equal(resLowest.matches[0].anchorTimeframe, '15MIN');
  assert.equal(resLowest.matches[0].timeStr, '2021.01.01 03:45:00');
  assert.equal(resLowest.matches[0].directionalScore, 100);
  assert.ok(resLowest.matches[0].matchScore > 90);
  assert.equal(resLowest.matches[0].snapshots.length, 3);

  // Parent window anchor across 2 timeframes (1H + 4H)
  const cfgParent: BestMatchConfig = {
    ...cfgLowest,
    selectedTimeframes: ['1H', '4H'],
    multiTfAnchor: 'parent_window',
    minMatchScore: 0,
  };
  const resParent = runBestMatchedCandlesSearch({ '1H': ds1H, '4H': ds4H }, cfgParent);
  assert.equal(resParent.totalCandidatesScanned, 2);
  assert.equal(resParent.matches.length, 2);
  assert.equal(resParent.matches[0].anchorTimeframe, '4H');
  assert.equal(resParent.matches[0].timeStr, '2021.01.01 00:00:00');
  assert.equal(resParent.matches[0].snapshots[0].candle.timeStr, '2021.01.01 03:00:00');
  assert.ok(resParent.matches[0].matchScore > resParent.matches[1].matchScore);

  // Non-overlapping datasets handled cleanly
  const dsFar1D = buildDataset(
    '1D',
    ['Time (UTC),Open,High,Low,Close,Volume ', '2024.01.01 00:00:00,40000,41000,39000,40500,10'].join('\n')
  );
  const nonOverlapRes = runBestMatchedCandlesSearch(
    { '1H': ds1H, '1D': dsFar1D },
    { ...cfgParent, selectedTimeframes: ['1H', '1D'] }
  );
  assert.equal(nonOverlapRes.matches.length, 0);
  assert.ok(nonOverlapRes.warningMessage?.includes('Non-overlapping'));
});

test('Mode B Single-File Pattern Search works with 1 CSV across K=1,2,3 reference sequences, volume toggle, and auto-scan', () => {
  // Construct 1H single-file dataset with repeated identical 2-bar bullish setup + high volume contrast + flat zero-range Doji
  const csv1H = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    // Setup #1 at 00:00-01:00 (high volume matching target)
    '2021.01.01 00:00:00,100,110,99,109,50',
    '2021.01.01 01:00:00,109,120,108,119,60',
    // Zero-range flat Doji (division-by-zero test!)
    '2021.01.01 02:00:00,119,119,119,119,0',
    // Bearish pin rejection bar
    '2021.01.01 03:00:00,119,135,115,117,12',
    // Setup #2 at 04:00-05:00 (same geometry as Setup #1, very low volume)
    '2021.01.01 04:00:00,117,127,116,126,1',
    '2021.01.01 05:00:00,126,137,125,136,1',
    // Latest reference sequence at 06:00-07:00 (strong bullish pair + elevated volume)
    '2021.01.01 06:00:00,136,146,135,145,55',
    '2021.01.01 07:00:00,145,156,144,155,65',
  ].join('\n');

  const ds1H = buildDataset('1H', csv1H);

  // Verify zero-range Doji produces finite zeroed features without NaN
  const feats = computeDatasetFeatures(ds1H.candles);
  assert.equal(feats[2].range, 0);
  assert.equal(feats[2].bodyRatio, 0);
  assert.equal(feats[2].upperWickRatio, 0);
  assert.equal(feats[2].lowerWickRatio, 0);
  assert.ok(!Number.isNaN(feats[2].rangeAtrRatio));
  assert.ok(!Number.isNaN(feats[2].volumeRatio));

  // K=2 Reference Search using Latest Sequence in File (referenceTimestamp: null) WITHOUT volume weight
  const baseCfg: BestMatchConfig = {
    scope: 'single_file',
    selectedTimeframes: ['1H'],
    multiTfAnchor: 'lowest_tf',
    singleTimeframe: '1H',
    singleSubMode: 'reference',
    sequenceLength: 2,
    referenceTimestamp: null,
    includeVolumeWeight: false,
    minMatchScore: 50,
    maxResults: 10,
    startDateUtc: '',
    endDateUtc: '',
  };

  const refNoVol = runBestMatchedCandlesSearch({ '1H': ds1H }, baseCfg);
  assert.equal(refNoVol.referenceSnapshots?.length, 2);
  assert.equal(refNoVol.referenceSnapshots?.[0].candle.timeStr, '2021.01.01 06:00:00');
  // Must exclude reference candles themselves (06:00 and overlapping 05:00)
  assert.ok(refNoVol.matches.every((m) => m.timeStr !== '2021.01.01 06:00:00'));
  assert.ok(refNoVol.matches.every((m) => m.volumeScore === null));

  // Turn ON volume weight toggle -> Setup #1 (high volume 50/60) must outrank Setup #2 (tiny volume 1/1)
  const refWithVol = runBestMatchedCandlesSearch(
    { '1H': ds1H },
    { ...baseCfg, includeVolumeWeight: true, minMatchScore: 0 }
  );
  assert.equal(refWithVol.matches[0].timeStr, '2021.01.01 00:00:00');
  assert.ok(refWithVol.matches[0].volumeScore !== null);

  // K=3 Reference Search works cleanly without error
  const refK3 = runBestMatchedCandlesSearch(
    { '1H': ds1H },
    { ...baseCfg, sequenceLength: 3, minMatchScore: 0 }
  );
  assert.equal(refK3.referenceSnapshots?.length, 3);
  assert.ok(refK3.matches.length >= 1);
  assert.equal(refK3.matches[0].snapshots.length, 3);

  // Auto-Scan K=1 & K=2 finds cleanest momentum/pin setups and filterAndRankBestMatches narrows by direction
  const autoK1 = runBestMatchedCandlesSearch(
    { '1H': ds1H },
    { ...baseCfg, singleSubMode: 'auto_scan', sequenceLength: 1, minMatchScore: 50 }
  );
  assert.ok(autoK1.matches.length >= 2);
  assert.ok(autoK1.matches.every((m) => !Number.isNaN(m.matchScore)));

  const bullOnly = filterAndRankBestMatches(autoK1.matches, {
    searchQuery: '',
    directionFilter: 'bullish',
    minScoreOverride: 50,
  });
  assert.ok(bullOnly.every((m) => m.dominantDirection === 'BULLISH'));
});

test('Mode 1A Single-Anchor Intraday Slot Match (00:01 UTC) evaluates same-TF & cross-TF daily recurrence accurately', () => {
  // 5 UTC calendar days:
  // Day 1 (Jan 01): 1MIN 00:01 BULL
  // Day 2 (Jan 02): 1MIN 00:01 BEAR
  // Day 3 (Jan 03): 1MIN 00:01 DOJI (anchor Doji -> must be skipped completely!)
  // Day 4 (Jan 04): 1MIN 00:01 BULL
  // Day 5 (Jan 05): 1MIN 00:01 BEAR
  //
  // Candidates:
  // - 1MIN 14:30: BULL, BEAR, BULL (skipped), BULL, BEAR => 4/4 = 100% (2 Bull, 2 Bear)
  // - 1MIN 09:00: BULL, BEAR, BEAR (skipped), BEAR, BEAR => 3/4 = 75% (1 Bull, 2 Bear)
  // - 15MIN 08:15: BULL, BEAR, BULL (skipped), BULL, BEAR => 4/4 = 100% (2 Bull, 2 Bear)
  // - 1H 20:00: BULL, BULL, BULL (skipped), BULL, BULL => 2/4 = 50% (2 Bull, 0 Bear)
  const csv1Min = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    // Day 1
    '2024.01.01 00:01:00,100,105,99,104,1',   // BULL
    '2024.01.01 09:00:00,100,105,99,103,1',   // BULL
    '2024.01.01 14:30:00,100,106,99,105,1',   // BULL
    // Day 2
    '2024.01.02 00:01:00,105,106,100,101,1',  // BEAR
    '2024.01.02 09:00:00,105,106,100,102,1',  // BEAR
    '2024.01.02 14:30:00,105,106,99,100,1',   // BEAR
    // Day 3 (Anchor DOJI -> excluded!)
    '2024.01.03 00:01:00,100,102,98,100,1',   // DOJI
    '2024.01.03 09:00:00,100,102,98,99,1',    // BEAR
    '2024.01.03 14:30:00,100,105,99,103,1',   // BULL
    // Day 4
    '2024.01.04 00:01:00,103,108,102,107,1',  // BULL
    '2024.01.04 09:00:00,107,108,104,105,1',  // BEAR (mismatch)
    '2024.01.04 14:30:00,105,110,104,109,1',  // BULL
    // Day 5
    '2024.01.05 00:01:00,109,110,104,105,1',  // BEAR
    '2024.01.05 09:00:00,105,106,100,101,1',  // BEAR
    '2024.01.05 14:30:00,101,102,97,98,1',    // BEAR
  ].join('\n');

  const csv15M = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2024.01.01 08:15:00,100,110,99,108,2',
    '2024.01.02 08:15:00,108,109,100,102,2',
    '2024.01.03 08:15:00,102,106,101,105,2',
    '2024.01.04 08:15:00,105,112,104,111,2',
    '2024.01.05 08:15:00,111,112,103,104,2',
  ].join('\n');

  const csv1H = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2024.01.01 20:00:00,100,110,99,105,5',
    '2024.01.02 20:00:00,105,110,104,109,5',
    '2024.01.03 20:00:00,109,115,108,114,5',
    '2024.01.04 20:00:00,114,120,113,118,5',
    '2024.01.05 20:00:00,118,125,117,122,5',
  ].join('\n');

  const ds1Min = buildDataset('1MIN', csv1Min);
  const ds15M = buildDataset('15MIN', csv15M);
  const ds1H = buildDataset('1H', csv1H);
  const datasets = { '1MIN': ds1Min, '15MIN': ds15M, '1H': ds1H };

  const baseCfg: IntradaySlotMatchConfig = {
    scopeMode: 'single_anchor',
    anchorTimeframe: '1MIN',
    anchorSlotKey: '00:01',
    targetTimeframes: ['1MIN', '15MIN', '1H'],
    directionFilter: 'any_non_doji',
    excludeSelfSlot: true,
    minCoOccurringDays: 3,
    minMatchRatePct: 50,
    maxResults: 25,
    startDateUtc: '',
    endDateUtc: '',
  };

  const res = runIntradaySlotMatchSearch(datasets, baseCfg);
  assert.equal(res.totalValidDaysEvaluated, 4); // Day 3 skipped
  assert.equal(res.anchorSlotKey, '00:01');
  // Self slot 1MIN 00:01 excluded
  assert.ok(
    !res.matches.some((m) => m.targetTimeframe === '1MIN' && m.targetSlotKey === '00:01')
  );

  // Top 4 slots: 1MIN 14:30 (100%), 15MIN 08:15 (100%), 1MIN 09:00 (75%), 1H 20:00 (50%)
  assert.equal(res.matches.length, 4);
  assert.equal(res.matches[0].targetTimeframe, '1MIN');
  assert.equal(res.matches[0].targetSlotKey, '14:30');
  assert.equal(res.matches[0].matchRatePct, 100);
  assert.equal(res.matches[0].matchedDays, 4);
  assert.equal(res.matches[0].totalCoOccurringDays, 4);
  assert.equal(res.matches[0].bullishMatches, 2);
  assert.equal(res.matches[0].bearishMatches, 2);
  assert.equal(res.matches[0].dayRecords.length, 4);
  assert.ok(res.matches[0].dayRecords.every((r) => r.dateStr !== '2024-01-03'));

  assert.equal(res.matches[1].targetTimeframe, '15MIN');
  assert.equal(res.matches[1].targetSlotKey, '08:15');
  assert.equal(res.matches[1].matchRatePct, 100);

  assert.equal(res.matches[2].targetTimeframe, '1MIN');
  assert.equal(res.matches[2].targetSlotKey, '09:00');
  assert.equal(res.matches[2].matchRatePct, 75);
  assert.equal(res.matches[2].bullishMatches, 1);
  assert.equal(res.matches[2].bearishMatches, 2);

  // Bearish-only direction filter check: 1H 20:00 had 0 bearish matches -> drops to 0%
  const bearRes = runIntradaySlotMatchSearch(datasets, {
    ...baseCfg,
    directionFilter: 'bearish_only',
    minMatchRatePct: 0,
  });
  const hr20 = bearRes.matches.find((m) => m.targetTimeframe === '1H' && m.targetSlotKey === '20:00')!;
  assert.equal(hr20.matchRatePct, 0);
  assert.equal(hr20.bearishMatches, 0);

  // Filter helper narrows to 15MIN target only
  const tfFiltered = filterAndRankIntradayMatches(res.matches, {
    searchQuery: '',
    targetTimeframeFilter: '15MIN',
    directionBiasFilter: 'all',
    minRateOverride: 0,
  });
  assert.equal(tfFiltered.length, 1);
  assert.equal(tfFiltered[0].targetSlotKey, '08:15');
});

test('Mode 1B Full-Matrix Intraday Bitset engine matches Single-Anchor results bit-for-bit', () => {
  const csv15M = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    // Day 1
    '2024.02.01 00:00:00,100,105,99,104,1',  // BULL
    '2024.02.01 04:00:00,104,109,103,108,1', // BULL
    '2024.02.01 12:00:00,108,109,103,104,1', // BEAR
    // Day 2
    '2024.02.02 00:00:00,104,105,98,100,1',  // BEAR
    '2024.02.02 04:00:00,100,101,95,96,1',   // BEAR
    '2024.02.02 12:00:00,96,102,95,101,1',   // BULL
    // Day 3
    '2024.02.03 00:00:00,101,107,100,106,1', // BULL
    '2024.02.03 04:00:00,106,112,105,111,1', // BULL
    '2024.02.03 12:00:00,111,112,110,111,1', // DOJI
    // Day 4
    '2024.02.04 00:00:00,111,112,106,107,1', // BEAR
    '2024.02.04 04:00:00,107,108,101,102,1', // BEAR
    '2024.02.04 12:00:00,102,109,101,108,1', // BULL
  ].join('\n');

  const csv1H = [
    'Time (UTC),Open,High,Low,Close,Volume ',
    '2024.02.01 08:00:00,100,106,99,105,2',  // BULL
    '2024.02.02 08:00:00,105,106,99,100,2',  // BEAR
    '2024.02.03 08:00:00,100,108,99,107,2',  // BULL
    '2024.02.04 08:00:00,107,108,102,103,2', // BEAR
  ].join('\n');

  const datasets = {
    '15MIN': buildDataset('15MIN', csv15M),
    '1H': buildDataset('1H', csv1H),
  };

  for (const directionFilter of ['any_non_doji', 'bullish_only', 'bearish_only'] as const) {
    const matrixRes = runIntradaySlotMatchSearch(datasets, {
      scopeMode: 'full_matrix',
      anchorTimeframe: '15MIN',
      anchorSlotKey: '00:00',
      targetTimeframes: ['15MIN', '1H'],
      directionFilter,
      excludeSelfSlot: true,
      minCoOccurringDays: 2,
      minMatchRatePct: 0,
      maxResults: 25,
      startDateUtc: '',
      endDateUtc: '',
    });

    assert.equal(matrixRes.totalAnchorSlotsEvaluated, 3);
    assert.equal(matrixRes.matrixSummaries.length, 3);

    // Compare every anchor summary's top targets directly against Single-Anchor mode
    for (const summary of matrixRes.matrixSummaries) {
      const singleRes = runIntradaySlotMatchSearch(datasets, {
        scopeMode: 'single_anchor',
        anchorTimeframe: '15MIN',
        anchorSlotKey: summary.anchorSlotKey,
        targetTimeframes: ['15MIN', '1H'],
        directionFilter,
        excludeSelfSlot: true,
        minCoOccurringDays: 2,
        minMatchRatePct: 0,
        maxResults: 10,
        startDateUtc: '',
        endDateUtc: '',
      });

      assert.equal(summary.topTargets.length, singleRes.matches.length);
      for (let i = 0; i < summary.topTargets.length; i++) {
        const mRow = summary.topTargets[i];
        const sRow = singleRes.matches[i];
        assert.equal(mRow.targetTimeframe, sRow.targetTimeframe);
        assert.equal(mRow.targetSlotKey, sRow.targetSlotKey);
        assert.equal(mRow.matchedDays, sRow.matchedDays);
        assert.equal(mRow.totalCoOccurringDays, sRow.totalCoOccurringDays);
        assert.equal(mRow.matchRatePct, sRow.matchRatePct);
        assert.equal(mRow.bullishMatches, sRow.bullishMatches);
        assert.equal(mRow.bearishMatches, sRow.bearishMatches);
      }
    }
  }
});



