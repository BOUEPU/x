import { EnrichedCandle, MatchedCandleSnapshot } from '../engine/types';

interface SingleCandleGlyphProps {
  candle: EnrichedCandle;
  width?: number;
  height?: number;
  rangeMin?: number;
  rangeMax?: number;
}

export function SingleCandleGlyph({
  candle,
  width = 18,
  height = 28,
  rangeMin,
  rangeMax,
}: SingleCandleGlyphProps) {
  const minP = rangeMin ?? candle.low;
  const maxP = rangeMax ?? candle.high;
  const span = maxP - minP;
  const padY = 2.5;
  const usableH = Math.max(4, height - padY * 2);

  const toY = (price: number): number => {
    if (span <= 0) return height / 2;
    const norm = (maxP - price) / span;
    return padY + norm * usableH;
  };

  const color =
    candle.candleType === 'BULLISH'
      ? '#10B981'
      : candle.candleType === 'BEARISH'
        ? '#EF4444'
        : '#F59E0B';

  const cx = width / 2;
  const bodyWidth = Math.max(4, Math.min(10, width * 0.48));
  const yHigh = toY(candle.high);
  const yLow = toY(candle.low);
  const yOpen = toY(candle.open);
  const yClose = toY(candle.close);
  const bodyTop = Math.min(yOpen, yClose);
  const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${candle.candleType} candle O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`}
      className="shrink-0"
    >
      <line
        x1={cx}
        y1={yHigh}
        x2={cx}
        y2={yLow}
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <rect
        x={cx - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        rx={0.75}
        fill={candle.candleType === 'DOJI' ? '#0B0F17' : color}
        stroke={color}
        strokeWidth={candle.candleType === 'DOJI' ? 1.4 : 0}
      />
    </svg>
  );
}

interface SnapshotStripGlyphsProps {
  snapshots: MatchedCandleSnapshot[];
  sharedScale?: boolean;
}

export function SnapshotStripGlyphs({
  snapshots,
  sharedScale = false,
}: SnapshotStripGlyphsProps) {
  let minP = Infinity;
  let maxP = -Infinity;
  if (sharedScale && snapshots.length > 0) {
    for (const s of snapshots) {
      if (s.candle.low < minP) minP = s.candle.low;
      if (s.candle.high > maxP) maxP = s.candle.high;
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      {snapshots.map((snap, idx) => (
        <div
          key={`${snap.timeframe}-${snap.candle.timestamp}-${idx}`}
          className="inline-flex flex-col items-center gap-0.5"
          title={`${snap.roleLabel}: O ${snap.candle.open} / H ${snap.candle.high} / L ${snap.candle.low} / C ${snap.candle.close} (${snap.candle.candleType})`}
        >
          <SingleCandleGlyph
            candle={snap.candle}
            width={16}
            height={26}
            rangeMin={sharedScale && Number.isFinite(minP) ? minP : undefined}
            rangeMax={sharedScale && Number.isFinite(maxP) ? maxP : undefined}
          />
          <span className="font-mono text-[9px] leading-none text-slate-400">
            {snapshots.length > 1 && snap.roleLabel.startsWith('Bar')
              ? `B${idx + 1}`
              : snap.timeframe}
          </span>
        </div>
      ))}
    </div>
  );
}

interface SequencePanelProps {
  title: string;
  subtitle: string;
  snapshots: MatchedCandleSnapshot[];
  sharedScale: boolean;
}

export function CandlestickComparisonPanel({
  title,
  subtitle,
  snapshots,
  sharedScale,
}: SequencePanelProps) {
  let minP = Infinity;
  let maxP = -Infinity;
  if (sharedScale && snapshots.length > 0) {
    for (const s of snapshots) {
      if (s.candle.low < minP) minP = s.candle.low;
      if (s.candle.high > maxP) maxP = s.candle.high;
    }
  }

  return (
    <div className="rounded border border-[#1E293B] bg-[#0D131E] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-[#1E293B] pb-2">
        <span className="text-xs font-semibold text-slate-100">{title}</span>
        <span className="font-mono text-[11px] text-slate-400">{subtitle}</span>
      </div>

      <div className="flex flex-wrap items-end justify-around gap-4 py-2">
        {snapshots.map((snap, idx) => {
          const typeColor =
            snap.candle.candleType === 'BULLISH'
              ? 'text-emerald-400'
              : snap.candle.candleType === 'BEARISH'
                ? 'text-red-400'
                : 'text-amber-400';

          return (
            <div
              key={`${snap.timeframe}-${snap.candle.timestamp}-${idx}`}
              className="flex min-w-[92px] flex-col items-center gap-1.5"
            >
              <span className="font-mono text-[11px] font-semibold text-slate-300">
                {snap.roleLabel}
              </span>
              <div className="flex h-24 items-center justify-center rounded border border-[#1E293B] bg-[#0B0F17] px-4 py-2">
                <SingleCandleGlyph
                  candle={snap.candle}
                  width={34}
                  height={76}
                  rangeMin={sharedScale && Number.isFinite(minP) ? minP : undefined}
                  rangeMax={sharedScale && Number.isFinite(maxP) ? maxP : undefined}
                />
              </div>
              <span className={`font-mono text-[11px] font-semibold ${typeColor}`}>
                {snap.candle.candleType}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-slate-400">
                Body {(snap.features.bodyRatio * 100).toFixed(0)}% ·{' '}
                {snap.features.rangeAtrRatio.toFixed(2)}x ATR
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
