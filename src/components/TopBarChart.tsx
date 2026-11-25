import { getDirectionScore } from '../engine/correlation';
import { DirectionFilter, PrincipalCandidateResult } from '../engine/types';

interface TopBarChartProps {
  candidates: PrincipalCandidateResult[];
  directionFilter: DirectionFilter;
  onSelectCandidate: (candidate: PrincipalCandidateResult) => void;
}

export function TopBarChart({
  candidates,
  directionFilter,
  onSelectCandidate,
}: TopBarChartProps) {
  const top15 = candidates.slice(0, 15);

  const metricLabel =
    directionFilter === 'bullish'
      ? 'Bullish Match %'
      : directionFilter === 'bearish'
        ? 'Bearish Match %'
        : 'Overall Alignment %';

  if (top15.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Top 15 Principal Candles horizontal bar chart"
      className="rounded border border-[#1E293B] bg-[#111824] p-5"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Top {top15.length} Principal Candles by {metricLabel}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Click any bar to inspect the full date-by-date historical match breakdown.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[1px] bg-emerald-400" aria-hidden="true" />
            <span>100% Exact</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[1px] bg-sky-400" aria-hidden="true" />
            <span>90%–99.9%</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[1px] bg-amber-400" aria-hidden="true" />
            <span>80%–89.9%</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[1px] bg-slate-500" aria-hidden="true" />
            <span>&lt; 80%</span>
          </span>
        </div>
      </div>

      <div className="space-y-2" role="list">
        {top15.map((item, idx) => {
          const score = getDirectionScore(item, directionFilter) ?? 0;
          const clampedWidth = Math.max(0, Math.min(100, score));

          const barColor =
            score >= 100
              ? 'bg-emerald-400'
              : score >= 90
                ? 'bg-sky-400'
                : score >= 80
                  ? 'bg-amber-400'
                  : 'bg-slate-500';

          const textColor =
            score >= 100
              ? 'text-emerald-400'
              : score >= 90
                ? 'text-sky-300'
                : score >= 80
                  ? 'text-amber-300'
                  : 'text-slate-300';

          return (
            <button
              key={item.slotKey}
              type="button"
              role="listitem"
              onClick={() => onSelectCandidate(item)}
              className="group grid w-full grid-cols-[28px_130px_1fr_112px] items-center gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-[#162032] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 sm:grid-cols-[32px_170px_1fr_132px]"
            >
              <span className="font-mono text-xs tabular-nums text-slate-500">
                #{idx + 1}
              </span>

              <div className="min-w-0">
                <div className="truncate font-mono text-xs font-medium text-slate-100 group-hover:text-amber-300">
                  {item.slotLabel}
                </div>
                <div className="truncate text-[11px] text-slate-500">
                  {item.searchTimeframe} · {item.timingRelation === 'BEFORE' ? 'Before' : item.timingRelation === 'INSIDE' ? 'Inside' : 'After'}
                </div>
              </div>

              <div className="relative h-5 w-full overflow-hidden rounded-[2px] bg-[#0B0F17]">
                {/* Reference 50% and 90% guide lines */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-[#1E293B]"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-[90%] w-px bg-[#1E293B]"
                />
                <div
                  className={`h-full ${barColor} transition-transform duration-200`}
                  style={{
                    transform: `scaleX(${clampedWidth / 100})`,
                    transformOrigin: 'left',
                  }}
                />
              </div>

              <div className="text-right font-mono text-xs tabular-nums">
                <span className={`font-semibold ${textColor}`}>
                  {score.toFixed(1)}%
                </span>
                <span className="ml-1.5 text-[11px] text-slate-500">
                  N={item.totalValidPairs}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
