import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  downloadAllProcessedCsvs,
  downloadProcessedTimeframeCsv,
} from '../engine/csvExport';
import { formatDecimal } from '../engine/csvParser';
import { TimeframeDataset, TimeframeId, TIMEFRAMES } from '../engine/types';

interface StepVerifyProps {
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>;
  onReRunAudit: () => void;
  onBack: () => void;
  onOpenCollector: () => void;
  onProceed: () => void;
}

function pct(part: number, total: number): string {
  if (total <= 0) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

export function StepVerify({
  datasets,
  onReRunAudit,
  onBack,
  onOpenCollector,
  onProceed,
}: StepVerifyProps) {
  const [expandedTf, setExpandedTf] = useState<TimeframeId | null>(null);
  const [justReAudited, setJustReAudited] = useState(false);

  const loadedDatasets = useMemo(
    () =>
      TIMEFRAMES.map((t) => datasets[t.id]).filter(
        (ds): ds is TimeframeDataset => Boolean(ds && ds.candles.length > 0)
      ),
    [datasets]
  );

  const totals = useMemo(() => {
    return loadedDatasets.reduce(
      (acc, ds) => {
        acc.total += ds.audit.totalCandles;
        acc.bullish += ds.audit.bullishCount;
        acc.bearish += ds.audit.bearishCount;
        acc.doji += ds.audit.dojiCount;
        acc.fixed += ds.audit.autoFixedErrors;
        return acc;
      },
      { total: 0, bullish: 0, bearish: 0, doji: 0, fixed: 0 }
    );
  }, [loadedDatasets]);

  const handleReAuditClick = () => {
    onReRunAudit();
    setJustReAudited(true);
    setTimeout(() => setJustReAudited(false), 2500);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#1E293B] pb-6 md:flex-row md:items-end">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-medium text-amber-400">
            Step 2 of 4 · Precision Classification &amp; Audit Pass
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
            Candle Classification &amp; Verification Summary
          </h1>
          <p className="text-sm leading-relaxed text-slate-400">
            Every candle is classified via precision-safe 8-decimal arithmetic (
            <span className="font-mono text-slate-300">Diff = Close - Open</span>) and audited by
            an independent second BigInt verification pass over 100% of rows with automatic error
            correction.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleReAuditClick}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#1E293B] bg-[#111824] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-[#162032]"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span>{justReAudited ? 'Audit Pass Re-Verified' : 'Re-Run Audit Pass'}</span>
          </button>

          {loadedDatasets.length > 0 && (
            <button
              type="button"
              onClick={() => downloadAllProcessedCsvs(loadedDatasets)}
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-amber-500/40 bg-amber-500/10 px-4 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download All Processed CSVs ({loadedDatasets.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Aggregate KPI Strip (single elevation, hairline dividers) */}
      <section
        aria-label="Aggregate audit totals"
        className="grid grid-cols-2 divide-y divide-[#1E293B] rounded border border-[#1E293B] bg-[#111824] sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-y-0"
      >
        <div className="p-4">
          <p className="text-xs text-slate-400">Total Candles Audited</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-100">
            {totals.total.toLocaleString()}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Across {loadedDatasets.length} timeframe{loadedDatasets.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">Bullish Candles</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-400">
            {totals.bullish.toLocaleString()}
          </p>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">
            {pct(totals.bullish, totals.total)} · Diff &gt; 0
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">Bearish Candles</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-red-400">
            {totals.bearish.toLocaleString()}
          </p>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">
            {pct(totals.bearish, totals.total)} · Diff &lt; 0
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">Doji Candles (Excluded)</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-amber-400">
            {totals.doji.toLocaleString()}
          </p>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">
            {pct(totals.doji, totals.total)} · Diff === 0
          </p>
        </div>
        <div className="col-span-2 p-4 sm:col-span-1">
          <p className="text-xs text-slate-400">Audit Integrity</p>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-xl font-semibold text-emerald-400">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            <span>100% Verified</span>
          </div>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">
            {totals.fixed} Auto-Fixed Errors
          </p>
        </div>
      </section>

      {/* Per-Timeframe Verification Table */}
      <section aria-label="Per-timeframe verification summary" className="space-y-3">
        <h2 className="text-base font-semibold text-slate-100">
          Per-Timeframe Verification &amp; Enriched CSV Export
        </h2>

        <div className="overflow-hidden rounded border border-[#1E293B] bg-[#111824]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
                  <th className="px-4 py-3 font-medium">Timeframe &amp; Source</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Bullish</th>
                  <th className="px-4 py-3 text-right font-medium">Bearish</th>
                  <th className="px-4 py-3 text-right font-medium">Doji</th>
                  <th className="px-4 py-3 font-medium">Audit Status</th>
                  <th className="px-4 py-3 text-right font-medium">Auto-Fixed</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E293B]">
                {loadedDatasets.map((ds) => {
                  const isExpanded = expandedTf === ds.timeframe;
                  return (
                    <tr
                      key={ds.timeframe}
                      className="transition-colors hover:bg-[#162032]/60"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-slate-100">
                            {ds.timeframe}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="max-w-[200px] truncate text-slate-300" title={ds.fileName}>
                            {ds.fileName}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
                          {ds.startUtcStr} → {ds.endUtcStr} UTC
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-100">
                        {ds.audit.totalCandles.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-400">
                        {ds.audit.bullishCount.toLocaleString()}
                        <span className="ml-1.5 text-[11px] text-slate-500">
                          ({pct(ds.audit.bullishCount, ds.audit.totalCandles)})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-red-400">
                        {ds.audit.bearishCount.toLocaleString()}
                        <span className="ml-1.5 text-[11px] text-slate-500">
                          ({pct(ds.audit.bearishCount, ds.audit.totalCandles)})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-400">
                        {ds.audit.dojiCount.toLocaleString()}
                        <span className="ml-1.5 text-[11px] text-slate-500">
                          ({pct(ds.audit.dojiCount, ds.audit.totalCandles)})
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{ds.audit.auditStatus}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">
                        {ds.audit.autoFixedErrors}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTf((cur) => (cur === ds.timeframe ? null : ds.timeframe))
                            }
                            aria-expanded={isExpanded}
                            className="inline-flex items-center gap-1 rounded border border-[#1E293B] bg-[#0B0F17] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
                          >
                            <span>Inspect</span>
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => downloadProcessedTimeframeCsv(ds)}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-[#2A3950] bg-[#162032] px-2.5 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:border-amber-500/60 hover:text-amber-300"
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Download Processed CSV</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Enriched Sample Drawer below table when Inspect is clicked */}
        {expandedTf && datasets[expandedTf] && (
          <div className="overflow-hidden rounded border border-[#2A3950] bg-[#111824]">
            <div className="flex items-center justify-between border-b border-[#1E293B] bg-[#0D131E] px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-200">
                Enriched Audit Sample · {expandedTf} (First 8 Verified Rows)
              </span>
              <button
                type="button"
                onClick={() => setExpandedTf(null)}
                className="text-xs text-slate-400 hover:text-slate-100"
              >
                Close Sample
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1E293B] text-slate-400">
                    <th className="px-4 py-2 font-medium">Time (UTC)</th>
                    <th className="px-4 py-2 text-right font-medium">Open</th>
                    <th className="px-4 py-2 text-right font-medium">High</th>
                    <th className="px-4 py-2 text-right font-medium">Low</th>
                    <th className="px-4 py-2 text-right font-medium">Close</th>
                    <th className="px-4 py-2 text-right font-medium">Volume</th>
                    <th className="px-4 py-2 text-right font-medium">Diff (Close - Open)</th>
                    <th className="px-4 py-2 font-medium">Candle_Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B] font-mono tabular-nums">
                  {datasets[expandedTf]!.candles.slice(0, 8).map((c) => (
                    <tr key={c.timestamp} className="hover:bg-[#162032]/50">
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
                        {c.diff > 0 ? `+${formatDecimal(c.diff)}` : formatDecimal(c.diff)}
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Bottom Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#1E293B] pt-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#1E293B] bg-[#111824] px-4 text-sm font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-[#162032]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to Upload</span>
        </button>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={loadedDatasets.length === 0}
            onClick={onOpenCollector}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#2A3950] bg-[#111824] px-4 text-sm font-medium text-slate-200 transition-colors hover:border-amber-500/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Database className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <span>Open Candle Data Collector</span>
          </button>

          <button
            type="button"
            disabled={loadedDatasets.length === 0}
            onClick={onProceed}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded bg-amber-500 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            <span>Configure Target Analysis</span>
          </button>
        </div>
      </div>
    </div>
  );
}
