// Worker-thread entry for lib/resume/extract/pdf.js. pdf.js runs here so the parent can TERMINATE
// it at the upload's deadline — a hard stop the in-thread code cannot give (pdf.js time-slices with
// microtasks, so a timer in its own thread never gets a turn). Posts exactly one message:
//   { result }                     the extraction (plain data: lines, text, layout, warnings)
//   { rejected: { code, detail } } a limit was hit (ArchiveRejected)
//   { error }                      anything else (the parent falls back to the bounded legacy reader)

import { parentPort, workerData } from 'node:worker_threads';
import { extractPdfLayoutInProcess } from './pdf.js';
import { ArchiveRejected } from '../../server/archiveGuard.js';

const { bytes, maxPages, deadline } = workerData;
try {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = await extractPdfLayoutInProcess(buffer, { maxPages, deadline });
  parentPort.postMessage({ result });
} catch (e) {
  if (e instanceof ArchiveRejected) parentPort.postMessage({ rejected: { code: e.code, detail: e.detail } });
  else parentPort.postMessage({ error: String((e && e.message) || e).slice(0, 200) });
}
