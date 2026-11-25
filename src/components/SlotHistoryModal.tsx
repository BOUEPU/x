import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Download, Sparkles, X } from 'lucide-react';
import { downloadSingleSlotHistoryCsv } from '../engine/csvExport';
import { formatDecimal } from '../engine/csvParser';
import { CandleType, CollectedCandleSlot } from '../engine/types';

interface SlotHistoryModalProps {
  slot: CollectedCandleSlot | null;
  excludeDojiFromPct: boolean;
  onClose: () => void;
  onUseAsTarget: (slot: CollectedCandleSlot) => void;
  onOpenInBestMatch?: (slot: CollectedCandleSlot) => void;
}

type TypeFilter = 'ALL' | CandleType;

const PAGE_SIZE = 100;

export function SlotHistoryModal({
  slot,
  excludeDojiFromPct,
  onClose,
  onUseAsTarget,
  onOpenInBestMatch,
}: SlotHistoryModalProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setTypeFilter('ALL');
    setPage(1);
  }, [slot?.id]);

  useEffect(() => {
    if (!slot) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [slot, onClose]);

  const filteredHistory = useMemo(() => {
    if (!slot) return [];
    if (typeFilter === 'ALL') return slot.history;
    return slot.history.filter((c) => c.candleType === typeFilter);
  }, [slot, typeFilter]);

  if (!slot) return null;

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredHistory.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  // Distribution bar percentages strictly across Bullish vs Bearish valid non-Doji occurrences
  const bullBarPct =
    slot.validNonDojiCount > 0
      ? (slot.bullishCount / slot.validNonDojiCount) * 100
      : 0;
  const bearBarPct =
    slot.validNonDojiCount > 0
      ? (slot.bearishCount / slot.validNonDojiCount) * 100
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="slot-history-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-5xl flex-col border-l border-[#1E293B] bg-[#0B0F17] shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1E293B] bg-[#111824] px-6 py-5">
          <div className="space-y-1">
            <p className="text-xs font-medium text-amber-400">
              Collected Candle Slot History · {slot.timeframe}
            </p>
            <h2
              id="slot-history-title"
              className="font-mono text-xl font-bold text-slate-50"
            >
              {slot.displayLabel}
            </h2>
            <p className="font-mono text-xs tabular-nums text-slate-400">
              {slot.history[0]?.timeStr ?? '—'} →{' '}
              {slot.history[slot.history.length - 1]?.timeStr ?? '—'} UTC
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenInBestMatch && (
              <button
                type="button"
                onClick={() => onOpenInBestMatch(slot)}
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded border border-amber-500/60 bg-amber-500/15 px-3.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Open in Best Match</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onUseAsTarget(slot)}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded bg-amber-500 px-3.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            >
              <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Use as Target Candle</span>
            </button>

            <button
              type="button"
              onClick={() => downloadSingleSlotHistoryCsv(slot)}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded border border-[#2A3950] bg-[#0B0F17] px-3 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/60 hover:text-amber-300"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export Slot CSV</span>
            </button>

            <button
              type="button"
              aria-label="Close slot history modal"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#1E293B] bg-[#0B0F17] text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 divide-x divide-y divide-[#1E293B] border-b border-[#1E293B] bg-[#0D131E] sm:grid-cols-4 lg:grid-cols-7 lg:divide-y-0">
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Total N</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-100">
              {slot.totalOccurrences.toLocaleString()}
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Valid Non-Doji</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-100">
              {slot.validNonDojiCount.toLocaleString()}
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Dominance</p>
            <p
              className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                slot.dominantDirection === 'BULLISH'
                  ? 'text-emerald-400'
                  : slot.dominantDirection === 'BEARISH'
                    ? 'text-red-400'
                    : 'text-slate-400'
              }`}
            >
              {slot.dominantDirection === 'NEUTRAL'
                ? '0.0%'
                : `${slot.dominantDirection} ${slot.dominancePct.toFixed(1)}%`}
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Avg Diff</p>
            <p
              className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                slot.avgDiff > 0
                  ? 'text-emerald-400'
                  : slot.avgDiff < 0
                    ? 'text-red-400'
                    : 'text-slate-300'
              }`}
            >
              {slot.avgDiff > 0 ? `+${formatDecimal(slot.avgDiff, 4)}` : formatDecimal(slot.avgDiff, 4)}
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Avg Range</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-200">
              {formatDecimal(slot.avgRange, 2)}
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-slate-400">Avg Volume</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-300">
              {formatDecimal(slot.avgVolume, 4)}
            </p>
          </div>
          <div className="col-span-2 px-4 py-3 sm:col-span-1">
            <p className="text-[11px] text-slate-400">Max Streaks (B / S)</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
              <span className="text-emerald-400">{slot.longestBullishStreak}</span>
              <span className="mx-1 text-slate-600">/</span>
              <span className="text-red-400">{slot.longestBearishStreak}</span>
            </p>
          </div>
        </div>

        {/* Compact Bullish vs. Bearish Distribution Bar */}
        <div className="border-b border-[#1E293B] bg-[#0B0F17] px-6 py-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
              <span className="font-semibold text-emerald-400">
                Bullish: {slot.bullishCount.toLocaleString()} ({slot.bullishPct.toFixed(1)}%)
              </span>
              <span className="font-semibold text-red-400">
                Bearish: {slot.bearishCount.toLocaleString()} ({slot.bearishPct.toFixed(1)}%)
              </span>
              <span className="text-amber-400">
                Doji: {slot.dojiCount.toLocaleString()} ({slot.dojiPct.toFixed(1)}%)
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              {excludeDojiFromPct
                ? 'Percentages computed over Valid Non-Doji occurrences'
                : 'Percentages computed over Total Occurrences (including Dojis)'}
            </span>
          </div>

          <div
            aria-label="Bullish versus Bearish distribution"
            className="flex h-3 w-full overflow-hidden rounded-[2px] bg-[#162032]"
          >
            {slot.validNonDojiCount > 0 ? (
              <>
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${bullBarPct}%` }}
                  title={`Bullish: ${bullBarPct.toFixed(1)}%`}
                />
                <div
                  className="h-full bg-red-500"
                  style={{ width: `${bearBarPct}%` }}
                  title={`Bearish: ${bearBarPct.toFixed(1)}%`}
                />
              </>
            ) : (
              <div className="h-full w-full bg-amber-500/40" title="All occurrences are Doji" />
            )}
          </div>
        </div>

        {/* Filter & Pagination Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E293B] bg-[#0B0F17] px-6 py-3">
          <div className="flex flex-wrap items-center gap-1 rounded border border-[#1E293B] bg-[#111824] p-1">
            {(
              [
                { id: 'ALL', label: `All (${slot.totalOccurrences})` },
                { id: 'BULLISH', label: `Bullish (${slot.bullishCount})` },
                { id: 'BEARISH', label: `Bearish (${slot.bearishCount})` },
                { id: 'DOJI', label: `Doji (${slot.dojiCount})` },
              ] as { id: TypeFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setTypeFilter(tab.id);
                  setPage(1);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  typeFilter === tab.id
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
                aria-label="Previous history page"
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
                aria-label="Next history page"
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#1E293B] bg-[#111824] text-slate-300 hover:border-slate-600 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Chronological Occurrences Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Time (UTC)</th>
                <th className="px-4 py-2.5 text-right font-medium">Open</th>
                <th className="px-4 py-2.5 text-right font-medium">High</th>
                <th className="px-4 py-2.5 text-right font-medium">Low</th>
                <th className="px-4 py-2.5 text-right font-medium">Close</th>
                <th className="px-4 py-2.5 text-right font-medium">Volume</th>
                <th className="px-4 py-2.5 text-right font-medium">Diff</th>
                <th className="px-4 py-2.5 font-medium">Candle_Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E293B] font-mono tabular-nums">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-10 text-center font-sans text-slate-500">
                    No historical candles match this direction filter.
                  </td>
                </tr>
              ) : (
                pageRows.map((c, idx) => (
                  <tr
                    key={c.timestamp}
                    className={
                      c.candleType === 'DOJI'
                        ? 'bg-amber-500/[0.03] hover:bg-amber-500/[0.06]'
                        : c.candleType === 'BULLISH'
                          ? 'hover:bg-emerald-500/[0.04]'
                          : 'hover:bg-red-500/[0.04]'
                    }
                  >
                    <td className="px-4 py-2 text-slate-500">
                      {(safePage - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-200">{c.timeStr}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{c.open}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{c.high}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{c.low}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{c.close}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{c.volume}</td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${
                        c.diff > 0
                          ? 'text-emerald-400'
                          : c.diff < 0
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {c.diff > 0 ? `+${formatDecimal(c.diff, 8)}` : formatDecimal(c.diff, 8)}
                    </td>
                    <td
                      className={`px-4 py-2 font-semibold ${
                        c.candleType === 'BULLISH'
                          ? 'text-emerald-400'
                          : c.candleType === 'BEARISH'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {c.candleType}
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
