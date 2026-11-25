import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileSpreadsheet,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  ParseProgress,
  TimeframeDataset,
  TimeframeId,
  TIMEFRAMES,
} from '../engine/types';

interface StepUploadProps {
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>;
  parseProgress: Partial<Record<TimeframeId, ParseProgress>>;
  parseErrors: Partial<Record<TimeframeId, string>>;
  selectedPreviewTf: TimeframeId | null;
  onSelectPreviewTf: (tf: TimeframeId) => void;
  onUploadFile: (tf: TimeframeId, file: File) => void;
  onRemoveDataset: (tf: TimeframeId) => void;
  onClearAll: () => void;
  onProceed: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function StepUpload({
  datasets,
  parseProgress,
  parseErrors,
  selectedPreviewTf,
  onSelectPreviewTf,
  onUploadFile,
  onRemoveDataset,
  onClearAll,
  onProceed,
}: StepUploadProps) {
  const [dragOverTf, setDragOverTf] = useState<TimeframeId | null>(null);
  const [showFormatGuide, setShowFormatGuide] = useState(false);
  const [showMalformedLog, setShowMalformedLog] = useState(false);
  const fileInputRefs = useRef<Partial<Record<TimeframeId, HTMLInputElement | null>>>({});

  const loadedTimeframes = useMemo(
    () =>
      TIMEFRAMES.map((t) => t.id).filter(
        (id) => datasets[id] && datasets[id]!.candles.length > 0
      ),
    [datasets]
  );

  const isParsingAny = Object.keys(parseProgress).length > 0;

  const activePreviewDataset = useMemo(() => {
    if (selectedPreviewTf && datasets[selectedPreviewTf]) {
      return datasets[selectedPreviewTf]!;
    }
    const firstId = loadedTimeframes[0];
    return firstId ? datasets[firstId]! : null;
  }, [datasets, loadedTimeframes, selectedPreviewTf]);

  const handleDrop = (tf: TimeframeId, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverTf(null);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onUploadFile(tf, file);
    }
  };

  const handleFileChange = (tf: TimeframeId, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(tf, file);
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#1E293B] pb-6 md:flex-row md:items-end">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-medium text-amber-400">Step 1 of 4 · Data Ingestion</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
            Upload Multi-Timeframe BTC CSV Files
          </h1>
          <p className="text-sm leading-relaxed text-slate-400">
            Upload any single timeframe for same-timeframe slot analysis, or 2+ timeframes for
            cross-timeframe Principal Candle correlation. All parsing runs locally in a Web Worker
            using strict UTC timestamps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowFormatGuide((prev) => !prev)}
            aria-expanded={showFormatGuide}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#1E293B] bg-[#111824] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-[#162032]"
          >
            <FileSpreadsheet className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <span>CSV Schema Reference</span>
            {showFormatGuide ? (
              <ChevronUp className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            )}
          </button>

          {loadedTimeframes.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded border border-[#1E293B] bg-[#111824] px-3.5 text-xs font-medium text-slate-300 transition-colors hover:border-red-500/40 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear All ({loadedTimeframes.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Collapsible CSV Schema Reference */}
      {showFormatGuide && (
        <section
          aria-label="Expected CSV schema"
          className="rounded border border-[#1E293B] bg-[#111824] p-5"
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-100">
                Strict Column Order &amp; UTC Timestamp Rules
              </h2>
              <ul className="space-y-1.5 text-xs leading-relaxed text-slate-400">
                <li>
                  <span className="font-mono text-slate-200">Header:</span>{' '}
                  <code className="font-mono text-amber-300">
                    Time (UTC),Open,High,Low,Close,Volume
                  </code>{' '}
                  (trailing whitespace trimmed automatically)
                </li>
                <li>
                  <span className="font-mono text-slate-200">Column 0:</span>{' '}
                  <code className="font-mono text-slate-300">YYYY.MM.DD HH:MM:SS</code> parsed
                  strictly via <code className="font-mono text-slate-300">Date.UTC</code>
                </li>
                <li>
                  <span className="font-mono text-slate-200">Columns 1–5:</span> Decimal numbers
                  for Open, High, Low, Close, Volume
                </li>
                <li>
                  <span className="font-mono text-slate-200">Sanitization:</span> Handles CRLF/LF,
                  skips blank rows, logs malformed rows, sorts ascending UTC, deduplicates exact
                  timestamps
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-100">Exact Format Example</h2>
              <pre className="overflow-x-auto rounded border border-[#1E293B] bg-[#0B0F17] p-3 font-mono text-xs leading-relaxed text-slate-300">
{`Time (UTC),Open,High,Low,Close,Volume 
2021.01.01 22:00:00,29222.5,29378.1,29176.1,29324.1,0.07027
2021.01.01 23:00:00,29326.1,29389.1,29288.6,29384.7,0.05382
2021.01.02 00:00:00,29384.5,29385.6,29017.1,29243.1,0.06978`}
              </pre>
            </div>
          </div>
        </section>
      )}

      {/* 10 Timeframe Upload Dropzones */}
      <section aria-label="Timeframe upload slots">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            10 Timeframe Slots · {loadedTimeframes.length} Loaded{' '}
            {loadedTimeframes.length >= 2
              ? '· Cross-Timeframe & Same-Timeframe Ready'
              : loadedTimeframes.length === 1
                ? '· Same-Timeframe Ready (upload a 2nd timeframe for Cross-Timeframe)'
                : '· Upload at least 1 CSV file to proceed'}
          </span>
          <span className="font-mono tabular-nums text-slate-500">
            UTC Strict · Client-Side Only
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {TIMEFRAMES.map((tf) => {
            const ds = datasets[tf.id];
            const progress = parseProgress[tf.id];
            const errorMsg = parseErrors[tf.id];
            const isDragging = dragOverTf === tf.id;
            const isSelectedPreview = activePreviewDataset?.timeframe === tf.id;

            const statusLabel = progress
              ? `Parsing ${progress.percent}%`
              : errorMsg
                ? 'Error'
                : ds?.status === 'verified'
                  ? 'Verified'
                  : ds?.status === 'loaded'
                    ? 'Loaded'
                    : 'Empty';

            const statusColorClass = progress
              ? 'text-amber-400'
              : errorMsg
                ? 'text-red-400'
                : ds
                  ? 'text-emerald-400'
                  : 'text-slate-500';

            return (
              <div
                key={tf.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverTf(tf.id);
                }}
                onDragLeave={() => setDragOverTf((cur) => (cur === tf.id ? null : cur))}
                onDrop={(e) => handleDrop(tf.id, e)}
                data-testid={`upload-slot-${tf.id}`}
                className={`flex flex-col justify-between rounded border p-4 transition-colors ${
                  isDragging
                    ? 'border-amber-500 bg-amber-500/5'
                    : isSelectedPreview
                      ? 'border-amber-500/60 bg-[#131C2B]'
                      : ds
                        ? 'border-[#253349] bg-[#111824]'
                        : errorMsg
                          ? 'border-red-500/40 bg-[#18121A]'
                          : 'border-[#1E293B] bg-[#111824] hover:border-[#334155]'
                }`}
              >
                <input
                  ref={(el) => {
                    fileInputRefs.current[tf.id] = el;
                  }}
                  type="file"
                  accept=".csv,text/csv"
                  aria-label={`Upload ${tf.id} CSV file`}
                  onChange={(e) => handleFileChange(tf.id, e)}
                  className="sr-only"
                />

                {/* Card Header */}
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-base font-semibold text-slate-100">
                      {tf.id}
                    </span>
                    <span className={`text-xs font-medium ${statusColorClass}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">{tf.label}</p>
                </div>

                {/* Card Middle Body */}
                <div className="my-4 min-h-[76px]">
                  {progress ? (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="capitalize text-slate-300">{progress.stage}...</span>
                        <span className="font-mono tabular-nums text-amber-400">
                          {progress.percent}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded bg-[#0B0F17]">
                        <div
                          className="h-full bg-amber-500 transition-transform duration-150"
                          style={{
                            transform: `scaleX(${progress.percent / 100})`,
                            transformOrigin: 'left',
                          }}
                        />
                      </div>
                      <p className="truncate font-mono text-[11px] tabular-nums text-slate-500">
                        {progress.rowsParsed.toLocaleString()} rows · {progress.fileName}
                      </p>
                    </div>
                  ) : errorMsg ? (
                    <div className="space-y-1.5 text-xs text-red-300">
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
                        <p className="line-clamp-3 leading-snug">{errorMsg}</p>
                      </div>
                    </div>
                  ) : ds ? (
                    <div className="space-y-1.5 text-xs">
                      <p className="truncate font-medium text-slate-200" title={ds.fileName}>
                        {ds.fileName}
                      </p>
                      <p className="font-mono tabular-nums text-slate-300">
                        {ds.rowCount.toLocaleString()} rows{' '}
                        <span className="text-slate-500">· {formatBytes(ds.fileSizeBytes)}</span>
                      </p>
                      <p className="font-mono text-[11px] tabular-nums text-slate-400">
                        {ds.startUtcStr?.slice(0, 16)}
                        <br />→ {ds.endUtcStr?.slice(0, 16)}
                      </p>
                      {(ds.malformedCount > 0 || ds.duplicateCount > 0) && (
                        <p className="text-[11px] text-amber-400">
                          {ds.malformedCount > 0 ? `${ds.malformedCount} malformed` : ''}
                          {ds.malformedCount > 0 && ds.duplicateCount > 0 ? ' · ' : ''}
                          {ds.duplicateCount > 0 ? `${ds.duplicateCount} dupes removed` : ''}
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRefs.current[tf.id]?.click()}
                      className="flex h-[76px] w-full flex-col items-center justify-center gap-1.5 rounded border border-dashed border-[#2A3950] bg-[#0B0F17]/60 text-xs text-slate-400 transition-colors hover:border-amber-500/60 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                    >
                      <Upload className="h-4 w-4 text-slate-500" aria-hidden="true" />
                      <span>Drop CSV or Browse</span>
                    </button>
                  )}
                </div>

                {/* Card Footer Actions */}
                <div className="flex items-center justify-between gap-2 border-t border-[#1E293B] pt-3">
                  {ds ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onSelectPreviewTf(tf.id)}
                        className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${
                          isSelectedPreview
                            ? 'text-amber-400'
                            : 'text-slate-300 hover:text-slate-100'
                        }`}
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{isSelectedPreview ? 'Previewing' : 'Preview'}</span>
                      </button>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => fileInputRefs.current[tf.id]?.click()}
                          className="text-xs text-slate-400 transition-colors hover:text-slate-100"
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${tf.id} dataset`}
                          onClick={() => onRemoveDataset(tf.id)}
                          className="text-xs text-slate-500 transition-colors hover:text-red-400"
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  ) : errorMsg ? (
                    <button
                      type="button"
                      disabled={Boolean(progress)}
                      onClick={() => fileInputRefs.current[tf.id]?.click()}
                      className="w-full text-left text-xs font-medium text-amber-400 transition-colors hover:text-amber-300 disabled:opacity-50"
                    >
                      Try another CSV
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-slate-500">
                      CSV · Strict UTC
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5-Row Preview Table */}
      <section aria-label="Uploaded CSV data preview" className="space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Uploaded Data Preview (First 5 Chronological UTC Rows)
            </h2>
            <p className="text-xs text-slate-400">
              Confirm timestamp parsing and column mapping before proceeding to audit verification.
            </p>
          </div>

          {loadedTimeframes.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 rounded border border-[#1E293B] bg-[#111824] p-1">
              {loadedTimeframes.map((tfId) => {
                const isActive = activePreviewDataset?.timeframe === tfId;
                return (
                  <button
                    key={tfId}
                    type="button"
                    onClick={() => onSelectPreviewTf(tfId)}
                    className={`rounded px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-[#1E293B] text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tfId}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {activePreviewDataset ? (
          <div className="overflow-hidden rounded border border-[#1E293B] bg-[#111824]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E293B] px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                <span className="font-mono font-semibold text-slate-100">
                  {activePreviewDataset.timeframe}
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>{activePreviewDataset.fileName}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="font-mono tabular-nums">
                  {activePreviewDataset.rowCount.toLocaleString()} verified rows
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="font-mono tabular-nums text-slate-400">
                  {activePreviewDataset.startUtcStr} → {activePreviewDataset.endUtcStr} UTC
                </span>
              </div>

              {activePreviewDataset.malformedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowMalformedLog((v) => !v)}
                  className="text-xs font-medium text-amber-400 hover:underline"
                >
                  {showMalformedLog ? 'Hide' : 'View'} {activePreviewDataset.malformedCount} malformed rows
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1E293B] bg-[#0D131E] text-slate-400">
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-4 py-2.5 font-medium">Time (UTC)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Open</th>
                    <th className="px-4 py-2.5 text-right font-medium">High</th>
                    <th className="px-4 py-2.5 text-right font-medium">Low</th>
                    <th className="px-4 py-2.5 text-right font-medium">Close</th>
                    <th className="px-4 py-2.5 text-right font-medium">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B] font-mono tabular-nums">
                  {activePreviewDataset.candles.slice(0, 5).map((candle, idx) => (
                    <tr key={candle.timestamp} className="hover:bg-[#162032]/70">
                      <td className="px-4 py-2.5 text-slate-500">{idx + 1}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-200">
                        {candle.timeStr}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-200">{candle.open}</td>
                      <td className="px-4 py-2.5 text-right text-slate-200">{candle.high}</td>
                      <td className="px-4 py-2.5 text-right text-slate-200">{candle.low}</td>
                      <td className="px-4 py-2.5 text-right text-slate-200">{candle.close}</td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{candle.volume}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {showMalformedLog && activePreviewDataset.malformedRows.length > 0 && (
              <div className="border-t border-[#1E293B] bg-[#0B0F17] p-4">
                <p className="mb-2 text-xs font-semibold text-amber-400">
                  Skipped Malformed Rows (showing first {activePreviewDataset.malformedRows.length} of{' '}
                  {activePreviewDataset.malformedCount})
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto font-mono text-[11px] text-slate-400">
                  {activePreviewDataset.malformedRows.map((m) => (
                    <div key={`${m.lineNumber}-${m.reason}`}>
                      <span className="text-slate-500">Line {m.lineNumber}:</span>{' '}
                      <span className="text-amber-300">{m.reason}</span> —{' '}
                      <span className="text-slate-500">{m.rawLine}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded border border-[#1E293B] bg-[#111824] px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-300">No CSV files loaded yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Drop or select a BTC OHLCV CSV file in any of the 10 timeframe slots above to inspect
              the 5-row preview table.
            </p>
          </div>
        )}
      </section>

      {/* Bottom Step Action Bar */}
      <div className="flex flex-col items-start justify-between gap-4 border-t border-[#1E293B] pt-6 sm:flex-row sm:items-center">
        <div className="text-xs text-slate-400">
          {loadedTimeframes.length === 0 ? (
            <span>Upload at least 1 timeframe CSV to unlock Step 2 (Verification &amp; Audit).</span>
          ) : (
            <span>
              <strong className="font-semibold text-slate-200">
                {loadedTimeframes.length} timeframe{loadedTimeframes.length > 1 ? 's' : ''}
              </strong>{' '}
              parsed and ready for independent double-check audit.
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={loadedTimeframes.length === 0 || isParsingAny}
          onClick={onProceed}
          className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded bg-amber-500 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
        >
          <span>Proceed to Classification &amp; Audit</span>
        </button>
      </div>
    </div>
  );
}
