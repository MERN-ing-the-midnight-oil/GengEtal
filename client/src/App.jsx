import { useCallback, useEffect, useState } from 'react';
import {
  addFriend,
  createJob,
  deleteJob,
  ensureNotebook,
  fetchFriends,
  fetchFriendsGallery,
  fetchJobs,
  fetchMyGalleryShare,
  fetchSetupStatus,
  fetchStatus,
  publishJob,
  removeFriend,
  saveBurnCalibration,
  saveCredentials,
  saveGenerationSettings,
  saveNotebookUrl,
  saveOAuthClient,
  setWorkerTier,
  switchGoogleAccount,
  unpublishJob,
} from './api.js';
import AccountSwitcher from './components/AccountSwitcher.jsx';
import BurnEstimator from './components/BurnEstimator.jsx';
import BurnJobToast from './components/BurnJobToast.jsx';
import FriendsPanel from './components/FriendsPanel.jsx';
import HfCredentialsForm from './components/HfCredentialsForm.jsx';
import JobForm from './components/JobForm.jsx';
import JobGallery from './components/JobGallery.jsx';
import SetupScreen from './components/SetupScreen.jsx';
import DisconnectReminder from './components/DisconnectReminder.jsx';
import StatusBanner from './components/StatusBanner.jsx';
import WorkerTierPicker from './components/WorkerTierPicker.jsx';
import {
  dismissJobAlert,
  hasArmedJobAlerts,
  subscribeJobAlerts,
  syncJobAlerts,
} from './jobAlert.js';

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
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [watchingSince, setWatchingSince] = useState(null);
  const [stagedPrompts, setStagedPrompts] = useState(null);
  const [alertArmed, setAlertArmed] = useState(() => hasArmedJobAlerts());
  const [accountNotice, setAccountNotice] = useState('');
  const [galleryMode, setGalleryMode] = useState('mine');
  const [galleryShare, setGalleryShare] = useState(null);
  const [friends, setFriends] = useState([]);
  const [friendItems, setFriendItems] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState('');

  const refreshSetup = useCallback(async () => {
    const setupRes = await fetchSetupStatus();
    setSetup(setupRes);
    return setupRes;
  }, []);

  const refreshFriends = useCallback(async () => {
    try {
      const [shareRes, friendsRes] = await Promise.all([
        fetchMyGalleryShare().catch(() => null),
        fetchFriends().catch(() => ({ friends: [] })),
      ]);
      if (shareRes?.share) setGalleryShare(shareRes.share);
      setFriends(friendsRes.friends || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const refreshFriendsGallery = useCallback(async () => {
    setFriendsLoading(true);
    setFriendsError('');
    try {
      const res = await fetchFriendsGallery();
      setFriends(res.friends || []);
      setFriendItems(res.items || []);
      if (res.errors?.length) {
        setFriendsError(
          res.errors
            .map((e) => `${e.email || e.friendId}: ${e.error}`)
            .join(' · ')
        );
      }
    } catch (err) {
      console.error(err);
      setFriendsError(err.message || 'Could not load friends gallery');
    } finally {
      setFriendsLoading(false);
    }
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
      const nextJobs = jobsRes.jobs || [];
      setJobs(nextJobs);
      setStatus(statusRes);

      // Armed alerts must see completion even when the gallery filter hides the job.
      if (hasArmedJobAlerts() && (filter !== 'all' || query)) {
        const allRes = await fetchJobs();
        syncJobAlerts(allRes.jobs || []);
      } else {
        syncJobAlerts(nextJobs);
      }

      await refreshFriends();
      if (galleryMode === 'friends') {
        await refreshFriendsGallery();
      }
    } catch (err) {
      console.error(err);
      setSetupError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter, query, refreshSetup, refreshFriends, refreshFriendsGallery, galleryMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'error' || params.get('notebook') === 'error') {
      setSetupError(params.get('message') || 'Setup failed');
    }
    if (params.get('auth') === 'ok') {
      const email = params.get('account');
      const isNew = params.get('new') === '1';
      if (email) {
        setAccountNotice(
          isNew
            ? `Signed in as ${email}. Open Colab with this same Google account.`
            : `Using Google account ${email}. Match this account in Colab.`
        );
      }
    }
    if (params.has('auth') || params.has('notebook')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => subscribeJobAlerts(() => setAlertArmed(hasArmedJobAlerts())), []);

  const pollMs =
    alertArmed || (watchingSince && Date.now() - watchingSince < WATCH_FAST_MS)
      ? WATCH_POLL_MS
      : POLL_MS;

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!watchingSince) return undefined;
    const phase = status?.worker?.phase;
    // Keep watching through notebook setup; clear shortly after the worker is up.
    if (phase === 'online' || phase === 'busy') {
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

  function handleUsePrompts(payload) {
    setStagedPrompts({
      prompt_1: payload.prompt_1,
      prompt_2: payload.prompt_2,
      // Unique key so reusing the same job prompts still re-applies.
      at: Date.now(),
    });
  }

  async function handleDelete(id) {
    dismissJobAlert(id);
    await deleteJob(id);
    await refresh();
  }

  async function handlePublish(id) {
    const res = await publishJob(id);
    if (res.share) setGalleryShare(res.share);
    await refresh();
  }

  async function handleUnpublish(id) {
    const res = await unpublishJob(id);
    if (res.share) setGalleryShare(res.share);
    await refresh();
  }

  async function handleAddFriend(galleryLink) {
    const res = await addFriend(galleryLink);
    setFriends(res.friends || []);
    if (galleryMode === 'friends') await refreshFriendsGallery();
  }

  async function handleRemoveFriend(friendId) {
    const res = await removeFriend(friendId);
    setFriends(res.friends || []);
    if (galleryMode === 'friends') await refreshFriendsGallery();
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

  async function handleWorkerTierChange(tier) {
    const res = await setWorkerTier(tier);
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            workerTier: res.workerTier,
            generation: res.generation || res.workerTier?.generation || prev.generation,
            burn: res.burn || prev.burn,
            notebook: res.notebook,
            notebookUrl: res.notebook?.url || null,
          }
        : prev
    );
    await refresh();
  }

  async function handleGenerationChange(payload) {
    const res = await saveGenerationSettings(payload);
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            generation: res.generation,
            workerTier: res.workerTier || prev.workerTier,
            burn: res.burn || prev.burn,
          }
        : prev
    );
    await refresh();
  }

  async function handleBurnCalibrate(payload) {
    const res = await saveBurnCalibration(payload);
    setStatus((prev) => (prev ? { ...prev, burn: res.burn } : prev));
    await refresh();
  }

  async function handleSaveNotebookUrl(url) {
    const tier = status?.workerTier?.tier || 'free';
    const res = await saveNotebookUrl({ url, tier });
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            workerTier: res.workerTier || prev.workerTier,
            notebook: res.notebook,
            notebookUrl: res.notebook?.url || null,
          }
        : prev
    );
    await refresh();
  }

  async function handleSwitchAccount(accountId) {
    setSwitchingAccount(true);
    setSetupError('');
    try {
      const res = await switchGoogleAccount(accountId);
      const label =
        res.googleAccount?.email ||
        res.googleAccount?.displayName ||
        'the selected account';
      setAccountNotice(
        `Switched to ${label}. Disconnect the previous Colab runtime, then open this account’s notebook and Run all.`
      );
      setWatchingSince(null);
      await refresh();
    } finally {
      setSwitchingAccount(false);
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

  const workerPhase = status?.worker?.phase;
  const colabAlive = workerPhase === 'online' || workerPhase === 'busy';
  const hasActiveJobs = jobs.some(
    (j) => j.status === 'pending' || j.status === 'processing'
  );

  return (
    <div className="app">
      <header className="brand brand-with-account">
        <div className="brand-copy">
          <h1>Ambiglyph Generator</h1>
          <p>
            This app is a simple dashboard for{' '}
            <a
              href="https://colab.research.google.com/github/dangeng/visual_anagrams/blob/main/notebooks/colab_demo_pro_tier.ipynb"
              target="_blank"
              rel="noreferrer"
            >
              Visual Anagrams
            </a>{' '}
            by{' '}
            <a
              href="https://github.com/dangeng/visual_anagrams"
              target="_blank"
              rel="noreferrer"
            >
              Geng et al.
            </a>{' '}
            — it wraps that Colab tool so you can queue prompt pairs and generate
            multi-view optical illusions without working in the notebook by hand.
          </p>
        </div>
        <AccountSwitcher
          googleAccount={setup?.googleAccount}
          googleAccounts={setup?.googleAccounts}
          onSwitchAccount={handleSwitchAccount}
          switching={switchingAccount}
        />
      </header>

      {accountNotice ? (
        <div className="account-notice" role="status">
          <p>{accountNotice}</p>
          <button
            type="button"
            className="text-link"
            onClick={() => setAccountNotice('')}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <StatusBanner
        status={status}
        hasActiveJobs={hasActiveJobs}
        watchingSince={watchingSince}
        onOpenNotebook={handleOpenNotebook}
      />

      <DisconnectReminder colabAlive={colabAlive} hasActiveJobs={hasActiveJobs} />

      <BurnJobToast jobs={jobs} burn={status?.burn} />

      <WorkerTierPicker
        workerTier={status?.workerTier || setup?.workerTier}
        generation={status?.generation || status?.workerTier?.generation}
        notebook={status?.notebook}
        onTierChange={handleWorkerTierChange}
        onGenerationChange={handleGenerationChange}
        onSaveNotebookUrl={handleSaveNotebookUrl}
      />

      <BurnEstimator burn={status?.burn} onCalibrate={handleBurnCalibrate} />

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

      <JobForm
        onSubmit={handleCreate}
        stagedPrompts={stagedPrompts}
        burn={status?.burn}
      />

      <div className="toolbar">
        <div className="gallery-mode" role="group" aria-label="Gallery source">
          <button
            type="button"
            className={`gallery-mode-btn${galleryMode === 'mine' ? ' is-active' : ''}`}
            onClick={() => setGalleryMode('mine')}
            aria-pressed={galleryMode === 'mine'}
          >
            My jobs
          </button>
          <button
            type="button"
            className={`gallery-mode-btn${galleryMode === 'friends' ? ' is-active' : ''}`}
            onClick={() => {
              setGalleryMode('friends');
              refreshFriendsGallery();
            }}
            aria-pressed={galleryMode === 'friends'}
          >
            Friends
            {friends.length ? ` (${friends.length})` : ''}
          </button>
        </div>
        {galleryMode === 'mine' ? (
          <>
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
          </>
        ) : null}
      </div>

      {galleryMode === 'friends' && friendsError ? (
        <p className="error" role="alert">
          {friendsError}
        </p>
      ) : null}

      <JobGallery
        jobs={galleryMode === 'mine' ? jobs : friendItems}
        loading={galleryMode === 'mine' ? loading : friendsLoading}
        onUsePrompts={handleUsePrompts}
        onDelete={handleDelete}
        onPublish={handlePublish}
        onUnpublish={handleUnpublish}
        colabAlive={colabAlive}
        readOnly={galleryMode === 'friends'}
        emptyMessage={
          galleryMode === 'friends'
            ? friends.length
              ? 'No published images from your friends yet.'
              : 'Add a friend below, then browse what they’ve published.'
            : null
        }
      />

      <FriendsPanel
        share={galleryShare}
        friends={friends}
        onRefreshShare={refreshFriends}
        onAddFriend={handleAddFriend}
        onRemoveFriend={handleRemoveFriend}
      />
    </div>
  );
}