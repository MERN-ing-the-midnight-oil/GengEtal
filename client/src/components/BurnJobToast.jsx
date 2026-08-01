import { useEffect, useRef, useState } from 'react';

/**
 * After a job gains an image (finished + synced), show an estimated burn warning.
 */
export default function BurnJobToast({ jobs, burn }) {
  const [toast, setToast] = useState(null);
  const seenRef = useRef(new Set());

  useEffect(() => {
    if (!jobs?.length || !burn?.estimate) return;

    for (const job of jobs) {
      if (!job.has_image || seenRef.current.has(job.id)) continue;
      // Only toast for newly observed completions in this session after mount.
      if (!seenRef.current.size && jobs.filter((j) => j.has_image).length > 1) {
        // Seed seen set on first run so we don't spam for historical jobs.
        for (const j of jobs) {
          if (j.has_image) seenRef.current.add(j.id);
        }
        return;
      }
      seenRef.current.add(job.id);
      setToast({
        id: job.id,
        summary: burn.estimate.summary,
        warning: burn.estimate.warning,
        range: `${burn.estimate.lowCu}–${burn.estimate.highCu} CU`,
      });
      break;
    }
  }, [jobs, burn]);

  if (!toast) return null;

  return (
    <div className="banner disconnect burn-toast" role="status" aria-live="polite">
      <div className="banner-copy">
        <strong>Job {toast.id} finished — estimated burn {toast.summary}</strong>
        <div className="banner-body">
          Ballpark {toast.range} for settings like this one (includes amortized setup/idle).{' '}
          {toast.warning} If the queue is empty, disconnect Colab now.
        </div>
      </div>
      <button type="button" className="watch-btn secondary" onClick={() => setToast(null)}>
        Dismiss
      </button>
    </div>
  );
}
