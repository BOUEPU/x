import { computeSafeDiff, formatUtcTimestamp } from './csvParser';
import { AuditSummary, CandleType, EnrichedCandle, RawCandle } from './types';

/**
 * Classifies a precision-safe diff value into BULLISH, BEARISH, or DOJI.
 */
export function classifyDiff(diff: number): CandleType {
  if (diff > 0) return 'BULLISH';
  if (diff < 0) return 'BEARISH';
  return 'DOJI';
}

/**
 * Independent BigInt 8-decimal string arithmetic recomputation of (Close - Open).
 * Used exclusively by the Double-Check & Auto-Fix Audit Pass so verification is
 * mathematically independent of floating-point scaled subtraction.
 */
function independentExactDiffBigInt(open: number, close: number): { diff: number; type: CandleType } {
  const toScaledBigInt = (n: number): bigint => {
    const fixed = n.toFixed(8);
    const isNeg = fixed.startsWith('-');
    const clean = isNeg ? fixed.slice(1) : fixed;
    const [intPart, fracPart = ''] = clean.split('.');
    const paddedFrac = fracPart.padEnd(8, '0').slice(0, 8);
    const bi = BigInt(`${intPart}${paddedFrac}`);
    return isNeg ? -bi : bi;
  };

  const openBi = toScaledBigInt(open);
  const closeBi = toScaledBigInt(close);
  const diffBi = closeBi - openBi;

  let type: CandleType = 'DOJI';
  if (diffBi > 0n) type = 'BULLISH';
  else if (diffBi < 0n) type = 'BEARISH';

  const diffNum = Number(diffBi) / 1e8;
  return {
    diff: Object.is(diffNum, -0) ? 0 : diffNum,
    type,
  };
}

/**
 * Pass 1: Initial classification pass computing Diff = Close - Open and Candle_Type.
 */
export function runInitialClassificationPass(rawCandles: RawCandle[]): EnrichedCandle[] {
  const enriched = new Array<EnrichedCandle>(rawCandles.length);
  for (let i = 0; i < rawCandles.length; i++) {
    const c = rawCandles[i];
    const diff = computeSafeDiff(c.open, c.close);
    const candleType = classifyDiff(diff);
    enriched[i] = {
      ...c,
      diff,
      candleType,
    };
  }
  return enriched;
}

export interface AuditPassResult {
  candles: EnrichedCandle[];
  summary: AuditSummary;
}

/**
 * Pass 2: Mandatory Double-Check & Auto-Fix Audit Pass.
 * Iterates over 100% of rows, independently recomputes (Close - Open) via exact
 * integer BigInt arithmetic, verifies both Diff and Candle_Type, and automatically
 * corrects any discrepancy while recording the exact count of auto-fixed rows.
 */
export function runIndependentAuditPass(enrichedCandles: EnrichedCandle[]): AuditPassResult {
  const verified = new Array<EnrichedCandle>(enrichedCandles.length);
  let bullishCount = 0;
  let bearishCount = 0;
  let dojiCount = 0;
  let autoFixedErrors = 0;

  for (let i = 0; i < enrichedCandles.length; i++) {
    const c = enrichedCandles[i];
    const expected = independentExactDiffBigInt(c.open, c.close);

    const diffMismatch = c.diff !== expected.diff;
    const typeMismatch = c.candleType !== expected.type;

    if (diffMismatch || typeMismatch) {
      autoFixedErrors++;
      verified[i] = {
        ...c,
        diff: expected.diff,
        candleType: expected.type,
      };
    } else {
      verified[i] = c;
    }

    if (verified[i].candleType === 'BULLISH') bullishCount++;
    else if (verified[i].candleType === 'BEARISH') bearishCount++;
    else dojiCount++;
  }

  return {
    candles: verified,
    summary: {
      totalCandles: verified.length,
      bullishCount,
      bearishCount,
      dojiCount,
      auditStatus: '100% Verified',
      autoFixedErrors,
      verifiedAtUtc: formatUtcTimestamp(Date.now()),
    },
  };
}

/**
 * Full 2-pass pipeline: Pass 1 classification followed immediately by Pass 2 audit & auto-fix.
 */
export function classifyAndAuditCandles(rawCandles: RawCandle[]): AuditPassResult {
  const pass1 = runInitialClassificationPass(rawCandles);
  return runIndependentAuditPass(pass1);
}
