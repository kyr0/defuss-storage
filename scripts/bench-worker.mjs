// Dedicated-worker side of the OPFS benchmark (bench-browsers.mjs). OPFS sync
// access handles exist only in dedicated workers, so the page starts this
// worker and sends one request: {config, namespace, versions: [{label, core,
// opfs}]}, where core and opfs are module URLs of one package build. The reply
// is {result, lines} or {error, lines}; lines are the log, one per event.
import { round, workloads } from './bench-core.mjs';

/**
 * Smallest observed step of `performance.now()`, in µs, recorded next to the
 * figures: a per-call latency below it is quantization. VERIFIED: (OPFS runs)
 * 5 µs in Chromium and 20 µs in Firefox and WebKit, cross-origin isolated.
 */
function timerStepMicros() {
  let step = Infinity;
  for (let i = 0; i < 100; i++) { const a = performance.now(); let b = a; while (b === a) b = performance.now(); step = Math.min(step, b - a); }
  return round(step * 1000);
}

self.onmessage = async ({ data }) => {
  const lines = [];
  try {
    const { sequentialSuite, optionsSuite } = workloads(data.config, message => lines.push(`${new Date().toISOString()} INFO ${message}`));
    const libs = await Promise.all(data.versions.map(async v => ({ label: v.label, core: await import(v.core), opfs: await import(v.opfs) })));
    // One namespace per build, so the two builds never share a file or a lock.
    const storages = {};
    for (const lib of libs) storages[lib.label] = await lib.opfs.createOPFSStorage({ name: `${data.namespace}-${lib.label}` });
    const results = await sequentialSuite('opfs', storages);
    const sequential = Object.fromEntries(libs.map(lib => [lib.label, { opfs: results[lib.label] }]));
    const options = await optionsSuite(libs[0].core, { async: await libs[0].opfs.createOPFSStorage({ name: `${data.namespace}-options` }) });
    self.postMessage({ result: { crossOriginIsolated: self.crossOriginIsolated, timerStepMicros: timerStepMicros(), sequential, options }, lines });
  } catch (error) { self.postMessage({ error: String(error?.stack ?? error), lines }); }
};
