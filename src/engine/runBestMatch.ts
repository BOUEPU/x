import { runBestMatchedCandlesSearch } from './correlation';
import { WorkerBestMatchRequest, WorkerParseResponse } from './csvWorker';
import {
  BestMatchConfig,
  BestMatchProgress,
  BestMatchResult,
  EnrichedCandle,
  TimeframeDataset,
  TimeframeId,
} from './types';

export const WORKER_ROW_THRESHOLD = 50_000;

export function countScannedCandlesForConfig(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>,
  config: BestMatchConfig
): number {
  if (config.scope === 'single_file') {
    return datasets[config.singleTimeframe]?.candles.length ?? 0;
  }
  return config.selectedTimeframes.reduce(
    (sum, tf) => sum + (datasets[tf]?.candles.length ?? 0),
    0
  );
}

/**
 * Executes Best Matched Candles search:
 * - For <= 50,000 scanned rows: executes swiftly on main thread after yielding one frame.
 * - For > 50,000 scanned rows: automatically offloads to a Web Worker with live progress updates
 *   (falling back cleanly to async main-thread if Worker instantiation fails).
 */
export function executeBestMatchSearchAsync(
  datasets: Partial<Record<TimeframeId, TimeframeDataset>>,
  config: BestMatchConfig,
  onProgress?: (progress: BestMatchProgress) => void
): Promise<BestMatchResult> {
  const totalRows = countScannedCandlesForConfig(datasets, config);

  const runDirectAsync = (): Promise<BestMatchResult> =>
    new Promise((resolve) => {
      onProgress?.({ percent: 10, scanned: 0, total: totalRows, stage: 'indexing' });
      setTimeout(() => {
        const res = runBestMatchedCandlesSearch(datasets, config, onProgress, false);
        resolve(res);
      }, 15);
    });

  if (totalRows <= WORKER_ROW_THRESHOLD || typeof Worker === 'undefined') {
    return runDirectAsync();
  }

  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./csvWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      void runDirectAsync().then(resolve);
      return;
    }

    const candlesByTf: Partial<Record<TimeframeId, EnrichedCandle[]>> = {};
    if (config.scope === 'single_file') {
      const ds = datasets[config.singleTimeframe];
      if (ds) candlesByTf[config.singleTimeframe] = ds.candles;
    } else {
      for (const tf of config.selectedTimeframes) {
        const ds = datasets[tf];
        if (ds) candlesByTf[tf] = ds.candles;
      }
    }

    worker.onmessage = (event: MessageEvent<WorkerParseResponse>) => {
      const msg = event.data;
      if (msg.type === 'best_match_progress') {
        onProgress?.(msg.progress);
      } else if (msg.type === 'best_match_complete') {
        worker.terminate();
        resolve(msg.result);
      } else if (msg.type === 'best_match_error') {
        worker.terminate();
        void runDirectAsync().then(resolve);
      }
    };

    worker.onerror = () => {
      worker.terminate();
      void runDirectAsync().then(resolve);
    };

    onProgress?.({ percent: 5, scanned: 0, total: totalRows, stage: 'indexing' });
    const req: WorkerBestMatchRequest = {
      type: 'best_match',
      candlesByTf,
      config,
    };
    worker.postMessage(req);
  });
}
