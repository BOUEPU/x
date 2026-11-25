import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatDecimal } from '../engine/csvParser';
import { PrincipalCandidateResult } from '../engine/types';

interface DrillDownDrawerProps {
  candidate: PrincipalCandidateResult | null;
  targetDescription: string;
  onClose: () => void;
}

type PairFilter = 'all' | 'match' | 'mismatch' | 'doji';

const PAGE_SIZE = 100;

export function DrillDownDrawer({
  candidate,
  targetDescription,
  onClose,
}: DrillDownDrawerProps) {
  const [pairFilter, setPairFilter] = useState<PairFilter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPairFilter('all');
    setPage(1);
  }, [candidate?.slotKey]);

  useEffect(() => {
    if (!candidate) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [candidate, onClose]);

  const counts = useMemo(() => {
    if (!candidate) return { all: 0, match: 0, mismatch: 0, doji: 0 };
    let match = 0;
    let mismatch = 0;
    let doji = 0;
    for (const p of candidate.pairs) {
      if (p.isDojiExcluded) doji++;
      else if (p.isMatch) match++;
      else mismatch++;
    }
    return { all: candidate.pairs.length, match, mismatch, doji };
  }, [candidate]);

  const filteredPairs = useMemo(() => {
    if (!candidate) return [];
    if (pairFilter === 'all') return candidate.pairs;
    if (pairFilter === 'doji') return candidate.pairs.filter((p) => p.isDojiExcluded);
    if (pairFilter === 'match') return candidate.pairs.filter((p) => !p.isDojiExcluded && p.isMatch);
    return candidate.pairs.filter((p) => !p.isDojiExcluded && !p.isMatch);
  }, [candidate, pairFilter]);

  if (!candidate) return null;

  const totalPages = Math.max(1, Math.ceil(filteredPairs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = filteredPairs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drilldown-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-4xl flex-col border-l border-[#1E293B] bg-[#0B0F17] shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#1E293B] bg-[#111824] px-6 py-5">
          <div className="space-y-1">
            <p className="text-xs font-medium text-amber-400">
              Date-by-Date Verification Breakdown · {targetDescription}
            </p>
            <h2
              id="drilldown-title"
              className="font-mono text-xl font-bold text-slate-50"
            >
              {candidate.slotLabel}{' '}
              <span className="text-sm font-normal text-slate-400">
                ({candidate.searchTimeframe})
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              {candidate.timingRelation} · {candidate.timingDetail}
            </p>
          </div>

          <button
            type="button"
            aria-label="Close drill-down breakdown"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#1E293B] bg-[#0B0F17] text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Summary Metrics Bar */}
        <div className="grid grid-cols-2 divide-x divide-y divide-[#1E293B] border-b border-[#1E293B] bg-[#0D131E] sm:grid-cols-5 sm:divide-y-0">
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Overall Alignment</p>
            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-400">
              {candidate.overallAlignmentScore.toFixed(2)}%
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Bullish Match</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-100">
              {candidate.bullishMatchRate !== null ? `${candidate.bullishMatchRate.toFixed(1)}%` : '—'}{' '}
              <span className="text-xs font-normal text-slate-500">
                ({candidate.bullishMatches}/{candidate.targetBullishCount})
              </span>
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Bearish Match</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-100">
              {candidate.bearishMatchRate !== null ? `${candidate.bearishMatchRate.toFixed(1)}%` : '—'}{' '}
              <span className="text-xs font-normal text-slate-500">
                ({candidate.bearishMatches}/{candidate.targetBearishCount})
              </span>
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Valid Pairs (N)</p>
            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-100">
              {candidate.totalValidPairs.toLocaleString()}
            </p>
          </div>
          <div className="col-span-2 px-4 py-3 sm:col-span-1">
            <p className="text-[11px] text-slate-400">Excluded Dojis</p>
            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-amber-400">
              {candidate.excludedDojiPairs.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E293B] bg-[#0B0F17] px-6 py-3">
          <div className="flex flex-wrap items-center gap-1 rounded border border-[#1E293B] bg-[#111824] p-1">
            {(
              [
                { id: 'all', label: `All (${counts.all})` },
                { id: 'match', label: `Matches (${counts.match})` },
                { id: 'mismatch', label: `Mismatches (${counts.mismatch})` },
                { id: 'doji', label: `Excluded Dojis (${counts.doji})` },
              ] as { id: PairFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setPairFilter(tab.id);
                  setPage(1);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  pairFilter === tab.id
                    ? 'bg-[#1E293B] text-amber-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-2 font-mono text-xs tabular-nums text-slate-400">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span>
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Date-by-Date Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">Cycle Date (UTC)</th>
                <th className="px-4 py-2.5 text-right font-medium">Target O / C</th>
                <th className="px-4 py-2.5 font-medium">Target Type</th>
                <th className="px-4 py-2.5 font-medium">Principal Time (UTC)</th>
                <th className="px-4 py-2.5 text-right font-medium">Principal O / C</th>
                <th className="px-4 py-2.5 font-medium">Principal Type</th>
                <th className="px-4 py-2.5 text-right font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E293B] font-mono tabular-nums">
              {pageSlice.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center font-sans text-slate-500">
                    No historical pairs match this filter.
                  </td>
                </tr>
              ) : (
                pageSlice.map((p) => (
                  <tr
                    key={`${p.cycleKey}-${p.principalTimestamp}`}
                    className={
                      p.isDojiExcluded
                        ? 'bg-amber-500/[0.03] text-slate-400'
                        : p.isMatch
                          ? 'hover:bg-emerald-500/[0.04]'
                          : 'bg-red-500/[0.03] hover:bg-red-500/[0.06]'
                    }
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-200">
                      {p.cycleDateStr}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-300">
                      {p.targetOpen} → {p.targetClose}
                      <span className="block text-[10px] text-slate-500">
                        Δ {p.targetDiff > 0 ? `+${formatDecimal(p.targetDiff)}` : formatDecimal(p.targetDiff)}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2.5 font-semibold ${
                        p.targetType === 'BULLISH'
                          ? 'text-emerald-400'
                          : p.targetType === 'BEARISH'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {p.targetType}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-300">
                      {p.principalTimeStr}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-300">
                      {p.principalOpen} → {p.principalClose}
                      <span className="block text-[10px] text-slate-500">
                        Δ {p.principalDiff > 0 ? `+${formatDecimal(p.principalDiff)}` : formatDecimal(p.principalDiff)}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2.5 font-semibold ${
                        p.principalType === 'BULLISH'
                          ? 'text-emerald-400'
                          : p.principalType === 'BEARISH'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {p.principalType}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">
                      {p.isDojiExcluded ? (
                        <span className="text-amber-400">DOJI EXCLUDED</span>
                      ) : p.isMatch ? (
                        <span className="text-emerald-400">MATCH</span>
                      ) : (
                        <span className="text-red-400">MISMATCH</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
