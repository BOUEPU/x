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
import { filterAndRankCandidates, runCorrelationAnalysis } from './correlation';
import { AnalysisConfig, EnrichedCandle, TimeframeDataset, TimeframeId } from './types';

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

