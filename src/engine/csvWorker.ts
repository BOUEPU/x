import { classifyAndAuditCandles } from './audit';
import {
  parseCsvDataLine,
  sortAndDeduplicateCandles,
  validateCsvHeader,
} from './csvParser';
import { MalformedRow, RawCandle, TimeframeDataset, TimeframeId } from './types';

export interface WorkerParseRequest {
  type: 'parse';
  timeframe: TimeframeId;
  file: File;
}

export type WorkerParseResponse =
  | {
      type: 'progress';
      timeframe: TimeframeId;
      fileName: string;
      percent: number;
      rowsParsed: number;
      stage: 'reading' | 'sorting' | 'auditing';
    }
  | {
      type: 'complete';
      dataset: TimeframeDataset;
    }
  | {
      type: 'error';
      timeframe: TimeframeId;
      fileName: string;
      errorMessage: string;
    };

const CHUNK_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB chunks for smooth streaming of multi-year 1MIN CSVs
const MAX_LOGGED_MALFORMED = 200;

self.onmessage = async (event: MessageEvent<WorkerParseRequest>) => {
  const msg = event.data;
  if (msg.type !== 'parse') return;

  const { timeframe, file } = msg;

  try {
    const totalBytes = file.size;
    const decoder = new TextDecoder('utf-8');
    let offset = 0;
    let leftover = '';
    let headerChecked = false;
    let headersDetected: string[] = [];
    let lineNumber = 0;

    const rawCandles: RawCandle[] = [];
    const malformedRows: MalformedRow[] = [];
    let malformedCount = 0;

    let lastProgressReport = 0;

    const postProgress = (percent: number, stage: 'reading' | 'sorting' | 'auditing') => {
      const resp: WorkerParseResponse = {
        type: 'progress',
        timeframe,
        fileName: file.name,
        percent: Math.min(100, Math.max(0, Math.round(percent))),
        rowsParsed: rawCandles.length,
        stage,
      };
      self.postMessage(resp);
    };

    postProgress(0, 'reading');

    const processLine = (line: string) => {
      lineNumber++;
      if (!headerChecked) {
        if (line.trim().length === 0) return;
        const headerRes = validateCsvHeader(line);
        if (!headerRes.valid) {
          throw new Error(headerRes.error || 'Invalid CSV header format.');
        }
        headerChecked = true;
        headersDetected = headerRes.headers;
        return;
      }

      const parsed = parseCsvDataLine(line, lineNumber);
      if (parsed.empty) return;
      if (parsed.malformed) {
        malformedCount++;
        if (malformedRows.length < MAX_LOGGED_MALFORMED) {
          malformedRows.push(parsed.malformed);
        }
      } else if (parsed.candle) {
        rawCandles.push(parsed.candle);
      }
    };

    while (offset < totalBytes) {
      const end = Math.min(offset + CHUNK_SIZE_BYTES, totalBytes);
      const slice = file.slice(offset, end);
      const buffer = await slice.arrayBuffer();
      const isFinalChunk = end >= totalBytes;
      const chunkText = decoder.decode(buffer, { stream: !isFinalChunk });

      const combined = leftover + chunkText;
      const parts = combined.split(/\r?\n/);

      if (isFinalChunk) {
        leftover = '';
        for (let i = 0; i < parts.length; i++) {
          processLine(parts[i]);
        }
      } else {
        leftover = parts.pop() ?? '';
        for (let i = 0; i < parts.length; i++) {
          processLine(parts[i]);
        }
      }

      offset = end;

      const now = Date.now();
      if (now - lastProgressReport >= 80 || isFinalChunk) {
        lastProgressReport = now;
        const pct = totalBytes > 0 ? (offset / totalBytes) * 80 : 80;
        postProgress(pct, 'reading');
      }
    }

    if (!headerChecked) {
      throw new Error('CSV file is empty or missing header row.');
    }

    if (rawCandles.length === 0) {
      throw new Error('No valid OHLCV rows were parsed from this CSV file.');
    }

    postProgress(85, 'sorting');
    const { candles: sortedRaw, duplicateCount } = sortAndDeduplicateCandles(rawCandles);

    postProgress(92, 'auditing');
    const { candles: verifiedCandles, summary } = classifyAndAuditCandles(sortedRaw);

    postProgress(100, 'auditing');

    const first = verifiedCandles[0];
    const last = verifiedCandles[verifiedCandles.length - 1];

    const dataset: TimeframeDataset = {
      timeframe,
      fileName: file.name,
      fileSizeBytes: file.size,
      status: 'verified',
      candles: verifiedCandles,
      rowCount: verifiedCandles.length,
      duplicateCount,
      malformedRows,
      malformedCount,
      startUtcMs: first ? first.timestamp : null,
      endUtcMs: last ? last.timestamp : null,
      startUtcStr: first ? first.timeStr : null,
      endUtcStr: last ? last.timeStr : null,
      audit: summary,
      headersDetected,
    };

    const completeMsg: WorkerParseResponse = {
      type: 'complete',
      dataset,
    };
    self.postMessage(completeMsg);
  } catch (err) {
    const errMsg: WorkerParseResponse = {
      type: 'error',
      timeframe,
      fileName: file.name,
      errorMessage: err instanceof Error ? err.message : 'Failed to parse CSV file.',
    };
    self.postMessage(errMsg);
  }
};
