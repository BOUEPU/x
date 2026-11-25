import { classifyAndAuditCandles } from './audit';
import { parseCsvText } from './csvParser';
import { WorkerParseRequest, WorkerParseResponse } from './csvWorker';
import { ParseProgress, TimeframeDataset, TimeframeId } from './types';

/**
 * Parses and audits a user-uploaded CSV File off the main thread using a Web Worker
 * with streaming progress updates. Gracefully falls back to async main-thread parsing
 * if Workers cannot be instantiated.
 */
export function parseTimeframeFile(
  timeframe: TimeframeId,
  file: File,
  onProgress: (progress: ParseProgress) => void
): Promise<TimeframeDataset> {
  return new Promise((resolve, reject) => {
    const runFallback = async () => {
      try {
        onProgress({ timeframe, fileName: file.name, percent: 15, rowsParsed: 0, stage: 'reading' });
        const text = await file.text();
        onProgress({ timeframe, fileName: file.name, percent: 65, rowsParsed: 0, stage: 'sorting' });
        const core = parseCsvText(text);
        if (core.rawCandles.length === 0) {
          throw new Error('No valid OHLCV rows were parsed from this CSV file.');
        }
        onProgress({
          timeframe,
          fileName: file.name,
          percent: 88,
          rowsParsed: core.rawCandles.length,
          stage: 'auditing',
        });
        const { candles, summary } = classifyAndAuditCandles(core.rawCandles);
        onProgress({
          timeframe,
          fileName: file.name,
          percent: 100,
          rowsParsed: candles.length,
          stage: 'auditing',
        });

        const first = candles[0];
        const last = candles[candles.length - 1];

        resolve({
          timeframe,
          fileName: file.name,
          fileSizeBytes: file.size,
          status: 'verified',
          candles,
          rowCount: candles.length,
          duplicateCount: core.duplicateCount,
          malformedRows: core.malformedRows,
          malformedCount: core.malformedCount,
          startUtcMs: first ? first.timestamp : null,
          endUtcMs: last ? last.timestamp : null,
          startUtcStr: first ? first.timeStr : null,
          endUtcStr: last ? last.timeStr : null,
          audit: summary,
          headersDetected: core.headersDetected,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to parse CSV file.'));
      }
    };

    if (typeof Worker === 'undefined') {
      void runFallback();
      return;
    }

    let worker: Worker;
    try {
      worker = new Worker(new URL('./csvWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      void runFallback();
      return;
    }

    worker.onmessage = (event: MessageEvent<WorkerParseResponse>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        onProgress({
          timeframe: msg.timeframe,
          fileName: msg.fileName,
          percent: msg.percent,
          rowsParsed: msg.rowsParsed,
          stage: msg.stage,
        });
      } else if (msg.type === 'complete') {
        worker.terminate();
        resolve(msg.dataset);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.errorMessage));
      }
    };

    worker.onerror = () => {
      worker.terminate();
      void runFallback();
    };

    const req: WorkerParseRequest = {
      type: 'parse',
      timeframe,
      file,
    };
    worker.postMessage(req);
  });
}
