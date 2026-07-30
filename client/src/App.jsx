import { useCallback, useEffect, useState } from 'react';
import {
  createJob,
  deleteJob,
  ensureNotebook,
  fetchJobs,
  fetchSetupStatus,
  fetchStatus,
  saveCredentials,
  saveOAuthClient,
} from './api.js';
import HfCredentialsForm from './components/HfCredentialsForm.jsx';
import JobForm from './components/JobForm.jsx';
import JobGallery from './components/JobGallery.jsx';
import SetupScreen from './components/SetupScreen.jsx';
import StatusBanner from './components/StatusBanner.jsx';

const POLL_MS = 8000;
const WATCH_POLL_MS = 3000;
const WATCH_FAST_MS = 3 * 60 * 1000;

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState('');
  const [notebookBusy, setNotebookBusy] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [savingOAuth, setSavingOAuth] = useState(false);
  const [watchingSince, setWatchingSince] = useState(null);

  const refreshSetup = useCallback(async () => {
    const setupRes = await fetchSetupStatus();
    setSetup(setupRes);
    return setupRes;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const setupRes = await refreshSetup();
      if (!setupRes.setupComplete) {
        setLoading(false);
        return;
      }

      const [jobsRes, statusRes] = await Promise.all([
        fetchJobs({ status: filter, q: query }),
        fetchStatus(),
      ]);
      setJobs(jobsRes.jobs || []);
      setStatus(statusRes);
    } catch (err) {
      console.error(err);
      setSetupError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter, query, refreshSetup]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'error' || params.get('notebook') === 'error') {
      setSetupError(params.get('message') || 'Setup failed');
    }
    if (params.has('auth') || params.has('notebook')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const pollMs =
    watchingSince && Date.now() - watchingSince < WATCH_FAST_MS ? WATCH_POLL_MS : POLL_MS;

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!watchingSince) return undefined;
    const phase = status?.worker?.phase;
    if (phase === 'online' || phase === 'busy') {
      // Keep the watching flag briefly so the banner can celebrate, then settle.
      const id = setTimeout(() => setWatchingSince(null), 12000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [watchingSince, status?.worker?.phase]);

  function handleOpenNotebook() {
    setWatchingSince(Date.now());
    refresh();
  }

  async function handleCreate(payload) {
    await createJob(payload);
    await refresh();
  }

  async function handleDelete(id) {
    await deleteJob(id);
    await refresh();
  }

  async function handleEnsureNotebook() {
    setNotebookBusy(true);
    setSetupError('');
    try {
      await ensureNotebook(true);
      await refresh();
    } catch (err) {
      setSetupError(err.message);
    } finally {
      setNotebookBusy(false);
    }
  }

  async function handleSaveCredentials(payload) {
    setSavingCredentials(true);
    setSetupError('');
    try {
      await saveCredentials(payload);
      await refresh();
    } finally {
      setSavingCredentials(false);
    }
  }

  async function handleSaveOAuthClient(payload) {
    setSavingOAuth(true);
    setSetupError('');
    try {
      await saveOAuthClient(payload);
      await refresh();
    } finally {
      setSavingOAuth(false);
    }
  }

  if (loading && !setup) {
    return (
      <div className="app">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  if (!setup?.setupComplete) {
    return (
      <SetupScreen
        setup={setup}
        error={setupError}
        busy={notebookBusy}
        savingCredentials={savingCredentials}
        savingOAuth={savingOAuth}
        onEnsureNotebook={handleEnsureNotebook}
        onSaveCredentials={handleSaveCredentials}
        onSaveOAuthClient={handleSaveOAuthClient}
      />
    );
  }

  const notebookUrl = status?.notebookUrl || setup?.notebook?.url;
  const hasActiveJobs = jobs.some(
    (j) => j.status === 'pending' || j.status === 'processing'
  );

  return (
    <div className="app">
      <header className="brand">
        <h1>Ambiglyph Generator</h1>
        <p>
          Queue prompt pairs locally. A Colab worker polls Google Drive and
          generates 1024×1024 rotate-180 illusions.
        </p>
        <p className="brand-credit">
          Based on Visual Anagrams by{' '}
          <a
            href="https://colab.research.google.com/github/dangeng/visual_anagrams/blob/main/notebooks/colab_demo_pro_tier.ipynb"
            target="_blank"
            rel="noreferrer"
          >
            Geng et al.
          </a>
        </p>
      </header>

      <StatusBanner
        status={status}
        hasActiveJobs={hasActiveJobs}
        watchingSince={watchingSince}
        onOpenNotebook={handleOpenNotebook}
      />

      <section className="panel hf-panel">
        <h2>Hugging Face login</h2>
        <p className="setup-note" style={{ marginTop: 0 }}>
          The Colab notebook reads this token from Drive. Update it anytime — check Remember me to
          keep it on this machine.
        </p>
        <HfCredentialsForm
          setup={setup}
          onSaveCredentials={handleSaveCredentials}
          savingCredentials={savingCredentials}
          compact
        />
      </section>

      <JobForm onSubmit={handleCreate} />

      <div className="toolbar">
        <div className="search">
          <input
            type="search"
            placeholder="Search prompts or job id…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search jobs"
          />
        </div>
        <div className="filter">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        {notebookUrl ? (
          <a
            className="watch-btn secondary toolbar-watch"
            href={notebookUrl}
            target="_blank"
            rel="noreferrer"
            onClick={handleOpenNotebook}
          >
            {hasActiveJobs ? 'Watch progress in Colab →' : 'Open Colab notebook →'}
          </a>
        ) : null}
      </div>

      <JobGallery
        jobs={jobs}
        loading={loading}
        notebookUrl={notebookUrl}
        onOpenNotebook={handleOpenNotebook}
        onReroll={handleCreate}
        onDelete={handleDelete}
      />
    </div>
  );
}