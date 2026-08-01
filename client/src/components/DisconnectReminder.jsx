import { useEffect, useRef, useState } from 'react';

/**
 * Shows a dismissible reminder when the queue becomes idle while Colab is still online.
 * Auto-disconnect from the local app isn't possible — Colab has no API for that.
 */
export default function DisconnectReminder({ colabAlive, hasActiveJobs }) {
  const [visible, setVisible] = useState(false);
  const hadActiveRef = useRef(hasActiveJobs);

  useEffect(() => {
    const wasActive = hadActiveRef.current;
    hadActiveRef.current = hasActiveJobs;

    if (wasActive && !hasActiveJobs && colabAlive) {
      setVisible(true);
      return;
    }
    if (hasActiveJobs || !colabAlive) {
      setVisible(false);
    }
  }, [hasActiveJobs, colabAlive]);

  if (!visible) return null;

  return (
    <div className="banner disconnect" role="status" aria-live="polite">
      <div className="banner-copy">
        <strong>Job finished — disconnect Colab to stop using compute units</strong>
        <div className="banner-body">
          In the Colab tab choose <strong>Runtime → Disconnect and delete runtime</strong>.
          Closing the tab is not enough; an idle GPU session still burns units.
        </div>
      </div>
      <button type="button" className="watch-btn secondary" onClick={() => setVisible(false)}>
        Dismiss
      </button>
    </div>
  );
}
