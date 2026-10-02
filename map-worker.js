/* map-worker.js: runs MapJobs off the main thread. Protocol:
   in : { id, type, job }   out: { id, kind:'progress', frac } | { id, kind:'result', result } | { id, kind:'error', message } */
importScripts('map-jobs.js?v=1');

self.onmessage = (e) => {
  const { id, type, job } = e.data;
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
