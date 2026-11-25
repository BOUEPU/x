import { computeDatasetFeatures } from './correlation';
import {
  CandleGeometryFeatures,
  EnrichedCandle,
  MatchedCandleSnapshot,
  SequenceLength,
  TimeframeId,
} from './types';

/**
 * Computes geometry features cleanly for a small window around the chosen reference index
 * so Step 3 preview stays O(1) even on 1,000,000-row CSV datasets.
 */
export function computeCandleFeaturesForSlice(
  candles: EnrichedCandle[],
  referenceTimestamp: number | null,
  sequenceLength: SequenceLength
): { startIdx: number; features: CandleGeometryFeatures[] } {
  const kLen = Math.max(1, Math.min(3, sequenceLength));
  let refIdx = Math.max(0, candles.length - kLen);
  if (referenceTimestamp !== null) {
    const exact = candles.findIndex((c) => c.timestamp === referenceTimestamp);
    if (exact !== -1) {
      refIdx = Math.min(exact, Math.max(0, candles.length - kLen));
    }
  }

  const sliceStart = Math.max(0, refIdx - 25);
  const sliceEnd = Math.min(candles.length, refIdx + kLen);
  const subFeatures = computeDatasetFeatures(candles.slice(sliceStart, sliceEnd));
  const localOffset = refIdx - sliceStart;

  return {
    startIdx: refIdx,
    features: subFeatures.slice(localOffset, localOffset + kLen),
  };
}

export function getReferencePreviewSnapshots(
  timeframe: TimeframeId,
  candles: EnrichedCandle[],
  sliceData: { startIdx: number; features: CandleGeometryFeatures[] },
  _referenceTimestamp: number | null,
  sequenceLength: SequenceLength
): MatchedCandleSnapshot[] {
  const kLen = Math.max(1, Math.min(3, sequenceLength));
  const out: MatchedCandleSnapshot[] = [];
  for (let p = 0; p < sliceData.features.length && sliceData.startIdx + p < candles.length; p++) {
    out.push({
      timeframe,
      roleLabel: kLen === 1 ? timeframe : `Bar ${p + 1}/${kLen}`,
      candle: candles[sliceData.startIdx + p],
      features: sliceData.features[p],
    });
  }
  return out;
}
