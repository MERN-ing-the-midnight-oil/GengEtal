import WatchColabButton from './WatchColabButton.jsx';

function formatAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.round(min / 60)}h`;
}

function resolveDisplay(status, { hasActiveJobs, watchingSince }) {
  const worker = status?.worker;
  const phase = worker?.phase || (status?.colabOnline ? 'online' : 'offline');
  const watching = Boolean(watchingSince);
  const waitSec = watching ? Math.round((Date.now() - watchingSince) / 1000) : 0;

  if (phase === 'online') {
    return {
      tone: 'online',
      title: worker?.label || 'Colab is online',
      body: hasActiveJobs
        ? 'A job is in the queue — the worker should pick it up on the next poll.'
        : worker?.detail || 'Worker heartbeat received — queue a prompt pair whenever you’re ready.',
      meta: worker?.ageMs != null ? `Heartbeat ${formatAge(worker.ageMs)} ago` : null,
      cta: hasActiveJobs ? 'Watch progress in Colab →' : 'Open Colab notebook →',
    };
  }

  if (phase === 'busy') {
    return {
      tone: 'busy',
      title: worker?.label || 'Generating in Colab',
      body: worker?.detail || 'Colab is working on a job.',
      meta: worker?.ageMs != null ? `Last heartbeat ${formatAge(worker.ageMs)} ago` : null,
      cta: 'Watch progress in Colab →',
    };
  }

  if (phase === 'error') {
    return {
      tone: 'error',
      title: worker?.label || 'Worker error',
      body: worker?.detail || 'The Colab poll loop reported an error.',
      meta: null,
      cta: 'Open Colab notebook →',
      steps: [
        'Check the Colab tab for a red error in the poll-loop cell',
        'Runtime → Restart session, then Runtime → Run all',
        'Confirm Google Drive is still mounted and HF login succeeded',
      ],
    };
  }

  if (phase === 'stuck') {
    return {
      tone: 'stuck',
      title: worker?.label || 'Worker looks stuck',
      body: worker?.detail || 'No recent progress from Colab.',
      meta: worker?.ageMs != null ? `Stale for ${formatAge(worker.ageMs)}` : null,
      cta: 'Open Colab notebook →',
      steps: [
        'Look for a hung generate.py cell or “Runtime disconnected”',
        'Interrupt / restart the runtime, then Runtime → Run all',
        'Leave the final poll-loop cell running',
      ],
    };
  }

  // Offline / not_running — richer copy after the user clicks Open
  if (watching && waitSec < 180 && (phase === 'offline' || phase === 'not_running')) {
    return {
      tone: 'waiting',
      title: phase === 'not_running' ? 'Opened but not running' : 'Waiting for Colab…',
      body:
        phase === 'not_running'
          ? worker?.detail ||
            'Notebook was online before, but the worker isn’t sending heartbeats. Run all cells again.'
          : `Notebook link opened${waitSec > 5 ? ` (${waitSec}s ago)` : ''}. No worker heartbeat yet — finish setup in the Colab tab.`,
      meta: 'Listening for heartbeat…',
      cta: 'Reopen Colab notebook →',
      steps: [
        'Runtime → Change runtime type → A100 GPU + High-RAM',
        'Runtime → Run all',
        'Allow Google Drive access when prompted',
        'Leave the last cell (poll loop) running',
      ],
    };
  }

  if (phase === 'not_running') {
    return {
      tone: 'offline',
      title: worker?.label || 'Opened but not running',
      body: worker?.detail || 'The notebook isn’t sending heartbeats.',
      meta: worker?.ageMs != null ? `Last seen ${formatAge(worker.ageMs)} ago` : null,
      cta: 'Open Colab notebook →',
      steps: [
        'Open the notebook, then Runtime → Change runtime type → A100 + High-RAM',
        'Click Runtime → Run all',
        'Allow Google Drive access so the worker can read the job queue',
        'Leave that Colab tab running',
      ],
    };
  }

  return {
    tone: 'offline',
    title: '⚠️ Colab is offline — Start it up!',
    body: worker?.detail || null,
    meta: null,
    cta: 'Open Colab notebook →',
    steps: [
      'Open the notebook, then go to Runtime → Change runtime type and choose A100 GPU with High-RAM on',
      'Click Runtime → Run all',
      'If prompted, allow Google Drive access so the worker can read the job queue',
      'Leave that Colab tab running — you can reopen it anytime to watch progress',
    ],
  };
}

export default function StatusBanner({ status, hasActiveJobs, watchingSince, onOpenNotebook }) {
  if (!status) return null;

  const notebookUrl = status.notebookUrl || 'https://colab.research.google.com/';
  const display = resolveDisplay(status, { hasActiveJobs, watchingSince });

  return (
    <div className={`banner ${display.tone}`} role="status" aria-live="polite">
      <div className="banner-copy">
        <strong>{display.title}</strong>
        {display.body ? <div className="banner-body">{display.body}</div> : null}
        {display.meta ? <div className="banner-meta">{display.meta}</div> : null}
        {display.steps ? (
          <ol className="banner-steps">
            {display.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
      </div>
      <WatchColabButton href={notebookUrl} label={display.cta} onOpen={onOpenNotebook} />
    </div>
  );
}
