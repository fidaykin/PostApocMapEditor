/* map-worker.js: runs MapJobs off the main thread. Protocol:
   in : { id, type, job, version }   out: { id, kind:'progress', frac } | { id, kind:'result', result } | { id, kind:'error'|'version-mismatch', message } */
importScripts('map-jobs.js?v=4');

self.onmessage = (e) => {
  const { id, type, job, version } = e.data;
  if (version !== self.MapJobs.VERSION) { self.postMessage({ id, kind: 'version-mismatch', message: 'map-jobs version ' + self.MapJobs.VERSION + ' != ' + version }); return; }
  try {
    const fn = self.MapJobs[type];
    if (!fn) throw new Error('Unknown job type: ' + type);
    const result = fn(job, frac => self.postMessage({ id, kind: 'progress', frac }));
    const transfer = [];
    for (const k of ['out', 'grid', 'elev', 'moist']) if (result[k] && result[k].buffer) transfer.push(result[k].buffer);
    self.postMessage({ id, kind: 'result', result }, transfer);
  } catch (err) {
    self.postMessage({ id, kind: 'error', message: String((err && err.message) || err) });
  }
};
