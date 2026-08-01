import WatchColabButton from './WatchColabButton.jsx';

const SETUP_STEPS = [
  { id: 'drive', label: 'Mount Google Drive' },
  { id: 'deps', label: 'Install dependencies' },
  { id: 'hf', label: 'Hugging Face login' },
  { id: 'clone', label: 'Clone generate.py repo' },
  { id: 'ready', label: 'Start worker loop' },
];

function formatAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.round(min / 60)}h`;
}

/** Map setup_step (furthest reached) → done / current / pending row states. */
function resolveSetupRows(setupStep) {
  const idx = SETUP_STEPS.findIndex((s) => s.id === setupStep);
  return SETUP_STEPS.map((step, i) => {
    if (idx < 0) {
      return { ...step, state: i === 0 ? 'waiting' : 'pending' };
    }
    if (setupStep === 'ready') {
      return { ...step, state: 'done' };
    }
    if (i < idx) return { ...step, state: 'done' };
    if (i === idx) return { ...step, state: 'current' };
    return { ...step, state: 'pending' };
  });
}

function setupPercent(rows) {
  const done = rows.filter((r) => r.state === 'done').length;
  const current = rows.some((r) => r.state === 'current' || r.state === 'waiting') ? 0.35 : 0;
  return Math.min(100, Math.round(((done + current) / SETUP_STEPS.length) * 100));
}

function SetupProgress({ setupStep, active }) {
  const rows = resolveSetupRows(setupStep);
  const percent = setupPercent(rows);
  const indeterminate = active && !setupStep;

  return (
    <div className="banner-progress" aria-label="Notebook setup progress">
      <div className="banner-progress-label">
        {setupStep === 'ready'
          ? 'Notebook setup complete'
          : setupStep
            ? 'Notebook is running…'
            : 'Listening for notebook progress…'}
      </div>
      <div
        className={`banner-progress-track${indeterminate ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : percent}
      >
        <div className="banner-progress-fill" style={indeterminate ? undefined : { width: `${percent}%` }} />
      </div>
      <ol className="banner-progress-steps">
        {rows.map((row) => (
          <li key={row.id} className={`banner-progress-step ${row.state}`}>
            <span className="banner-progress-marker" aria-hidden="true" />
            <span>{row.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function runtimeLabel(status) {
  const tier = status?.workerTier;
  if (!tier) return 'A100 GPU + High-RAM';
  return tier.highRam ? `${tier.accelerator} + High-RAM` : tier.accelerator;
}

function resolveDisplay(status, { hasActiveJobs, watchingSince }) {
  const worker = status?.worker;
  const phase = worker?.phase || (status?.colabOnline ? 'online' : 'offline');
  const setupStep = worker?.setupStep || null;
  const watching = Boolean(watchingSince);
  const waitSec = watching ? Math.round((Date.now() - watchingSince) / 1000) : 0;
  const runtime = runtimeLabel(status);
  const tierLabel = status?.workerTier?.label || 'Pro tier';
  const resolution = status?.workerTier?.resolution || '1024×1024';

  if (phase === 'online') {
    if (!hasActiveJobs) {
      return {
        tone: 'disconnect',
        title: 'Queue empty — disconnect Colab to save units',
        body: 'Your GPU runtime is still connected and burning compute units. In the Colab tab: Runtime → Disconnect and delete runtime.',
        meta: [
          worker?.ageMs != null ? `Heartbeat ${formatAge(worker.ageMs)} ago` : null,
          `${tierLabel} · ${resolution}`,
        ]
          .filter(Boolean)
          .join(' · '),
        cta: 'Open Colab notebook →',
        steps: [
          'Colab → Runtime → Disconnect and delete runtime',
          'Or Runtime → Manage sessions → End the active session',
          'Closing the browser tab alone is not enough',
        ],
        showProgress: false,
        setupStep,
      };
    }
    return {
      tone: 'online',
      title: worker?.label || 'Colab is online',
      body: 'A job is in the queue — the worker should pick it up on the next poll.',
      meta: [
        worker?.ageMs != null ? `Heartbeat ${formatAge(worker.ageMs)} ago` : null,
        `${tierLabel} · ${resolution}`,
      ]
        .filter(Boolean)
        .join(' · '),
      cta: 'Open Colab notebook →',
      showProgress: watching && setupStep === 'ready',
      setupStep,
    };
  }

  if (phase === 'busy') {
    return {
      tone: 'busy',
      title: worker?.label || 'Generating in Colab',
      body: worker?.detail || 'Colab is working on a job.',
      meta: worker?.ageMs != null ? `Last heartbeat ${formatAge(worker.ageMs)} ago` : null,
      cta: 'Open Colab notebook →',
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

  if (phase === 'starting') {
    return {
      tone: 'starting',
      title: worker?.label || 'Colab is starting…',
      body: worker?.detail || 'Notebook cells are running — hang tight.',
      meta: worker?.ageMs != null ? `Last update ${formatAge(worker.ageMs)} ago` : 'Listening for progress…',
      cta: 'Reopen Colab notebook →',
      steps: [
        'Leave the Colab tab open while cells finish',
        'Allow Google Drive access if prompted',
        'The worker is ready when the last cell (poll loop) stays running',
      ],
      showProgress: true,
      setupStep,
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
        `Runtime → Change runtime type → ${runtime}`,
        'Runtime → Run all',
        'Allow Google Drive access when prompted',
        'Leave the last cell (poll loop) running',
      ],
      showProgress: true,
      setupStep,
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
        `Open the ${tierLabel} notebook, then Runtime → Change runtime type → ${runtime}`,
        'Click Runtime → Run all',
        'Allow Google Drive access so the worker can read the job queue',
        'Leave that Colab tab running',
      ],
      showProgress: Boolean(setupStep),
      setupStep,
    };
  }

  return {
    tone: 'offline',
    title: '⚠️ Colab is offline — Start it up!',
    body: worker?.detail || null,
    meta: `${tierLabel} · ${resolution}`,
    cta: 'Open Colab notebook →',
    steps: [
      `Open the ${tierLabel} notebook, then Runtime → Change runtime type → ${runtime}`,
      'Click Runtime → Run all',
      'If prompted, allow Google Drive access so the worker can read the job queue',
      'Leave that Colab tab running — you can reopen it anytime to watch progress',
    ],
  };
}

export default function StatusBanner({ status, hasActiveJobs, watchingSince, onOpenNotebook }) {
  if (!status) return null;

  const needsNotebookLink =
    status.workerTier?.tier === 'free' && !status.notebookUrl;
  const notebookUrl = status.notebookUrl || 'https://colab.research.google.com/';
  const display = resolveDisplay(status, { hasActiveJobs, watchingSince });

  return (
    <div className={`banner ${display.tone}`} role="status" aria-live="polite">
      <div className="banner-copy">
        <strong>{display.title}</strong>
        {display.body ? <div className="banner-body">{display.body}</div> : null}
        {display.meta ? <div className="banner-meta">{display.meta}</div> : null}
        {needsNotebookLink ? (
          <div className="banner-body">
            Link your free-tier notebook below (upload{' '}
            <code>notebooks/batch_worker_free.ipynb</code>), then open it from here.
          </div>
        ) : null}
        {display.steps ? (
          <ol className="banner-steps">
            {display.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
        {display.showProgress ? (
          <SetupProgress setupStep={display.setupStep} active={Boolean(watchingSince) || display.tone === 'starting'} />
        ) : null}
      </div>
      {needsNotebookLink ? null : (
        <WatchColabButton href={notebookUrl} label={display.cta} onOpen={onOpenNotebook} />
      )}
    </div>
  );
}
