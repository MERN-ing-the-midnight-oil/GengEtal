import { useState } from 'react';
import HfCredentialsForm from './HfCredentialsForm.jsx';

export default function SetupScreen({
  setup,
  error,
  onEnsureNotebook,
  onSaveCredentials,
  onSaveOAuthClient,
  busy,
  savingCredentials,
  savingOAuth,
}) {
  const authenticated = Boolean(setup?.authenticated);
  const notebookReady = Boolean(setup?.notebook?.ready);
  const hfReady = Boolean(setup?.secrets?.huggingface?.configured);
  const driveAppReady = Boolean(setup?.driveConfigured);
  const isOwner = Boolean(setup?.notebook?.isOwner);
  const redirectUri =
    setup?.oauthRedirectUri || 'http://localhost:2222/api/setup/auth/google/callback';

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [oauthError, setOauthError] = useState('');

  async function handleSaveOAuth(e) {
    e.preventDefault();
    setOauthError('');
    try {
      await onSaveOAuthClient({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      });
      setClientSecret('');
    } catch (err) {
      setOauthError(err.message);
    }
  }

  return (
    <div className="app setup-app">
      <header className="brand">
        <h1>Ambiglyph Generator</h1>
        <p>Set up once, then queue illusions while Colab does the heavy lifting.</p>
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

      {!driveAppReady ? (
        <section className="panel setup-panel">
          <h2>Developer setup (one-time)</h2>
          <p className="setup-note" style={{ marginTop: 0 }}>
            Create a Google Cloud OAuth <strong>Web application</strong> client, then paste the ID
            and secret here. End users only click Login with Google after this.
          </p>
          <ol className="setup-list">
            <li>
              Open{' '}
              <a
                href="https://console.cloud.google.com/auth/clients/create?project=visual-anagrams-batch"
                target="_blank"
                rel="noreferrer"
              >
                Create OAuth client
              </a>{' '}
              (project <code>visual-anagrams-batch</code>)
            </li>
            <li>
              Application type: <strong>Web application</strong>
            </li>
            <li>
              Authorized redirect URI:
              <br />
              <code>{redirectUri}</code>
            </li>
            <li>
              Also enable the{' '}
              <a
                href="https://console.cloud.google.com/apis/library/drive.googleapis.com?project=visual-anagrams-batch"
                target="_blank"
                rel="noreferrer"
              >
                Google Drive API
              </a>
            </li>
            <li>
              On the consent screen scopes, include{' '}
              <code>.../auth/drive.file</code> (per-file / app-created access — not full Drive)
            </li>
            <li>Paste Client ID + Client Secret below</li>
          </ol>

          <form className="credentials-form" onSubmit={handleSaveOAuth}>
            <div className="field">
              <label htmlFor="clientId">Client ID</label>
              <input
                id="clientId"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="xxxx.apps.googleusercontent.com"
                autoComplete="off"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="clientSecret">Client Secret</label>
              <input
                id="clientSecret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="GOCSPX-…"
                autoComplete="off"
                required
              />
            </div>
            {oauthError ? <p className="form-error">{oauthError}</p> : null}
            <button className="btn" type="submit" disabled={savingOAuth}>
              {savingOAuth ? 'Saving…' : 'Save OAuth client'}
            </button>
          </form>
        </section>
      ) : null}

      <section className="panel setup-panel">
        <h2>Before you start</h2>
        <p className="setup-note" style={{ marginTop: 0 }}>
          Save your Hugging Face token, then Login with Google. No Google API keys for normal use —
          the app handles Drive access after you authorize it.
        </p>

        <HfCredentialsForm
          setup={setup}
          onSaveCredentials={onSaveCredentials}
          savingCredentials={savingCredentials}
          error={!hfReady ? error : ''}
        />

        <fieldset className="cred-block checklist" style={{ marginTop: '1.1rem' }}>
          <legend>Also required</legend>
          <ul className="setup-list">
            <li>
              <a href="https://colab.research.google.com/signup" target="_blank" rel="noreferrer">
                Colab Pro
              </a>{' '}
              (~$9.99/mo)
            </li>
            <li>
              In Colab: <strong>Runtime → Change runtime type</strong> → Python 3,{' '}
              <strong>A100 GPU</strong>, <strong>High-RAM</strong> on
              <img
                className="runtime-shot"
                src="/colab-runtime.png"
                alt="Colab Change runtime type dialog with A100 GPU and High-RAM enabled"
              />
            </li>
          </ul>
        </fieldset>
      </section>

      <section className="panel setup-panel">
        <h2>Login with Google</h2>
        <p className="setup-note" style={{ marginTop: 0 }}>
          Authorize limited Drive access — only the app’s{' '}
          <code>visual_anagrams</code> / <code>visual_anagrams_results</code> folders (not your
          whole Drive). You’ll get a normal Google consent screen; the token stays on this machine.
        </p>

        {error && hfReady ? <p className="form-error">{error}</p> : null}

        <div className="setup-actions">
          {!driveAppReady ? (
            <button className="btn google-btn" type="button" disabled>
              Login with Google (save OAuth client first)
            </button>
          ) : !hfReady ? (
            <button className="btn google-btn" type="button" disabled>
              Login with Google (save HF token first)
            </button>
          ) : !authenticated ? (
            <a className="btn google-btn" href="/api/setup/auth/google">
              Login with Google
            </a>
          ) : !notebookReady ? (
            <button className="btn" type="button" onClick={onEnsureNotebook} disabled={busy}>
              {busy ? 'Setting up notebook…' : 'Set up Colab notebook'}
            </button>
          ) : (
            <a className="btn" href={setup.notebook.url} target="_blank" rel="noreferrer">
              Open Colab notebook →
            </a>
          )}

          <a
            className="text-link"
            href={setup?.templateNotebookUrl}
            target="_blank"
            rel="noreferrer"
          >
            View shared template
          </a>
        </div>

        {authenticated ? (
          <p className="setup-note">
            Signed in with Google.
            {notebookReady ? (
              <>
                {' '}
                {isOwner
                  ? 'Using your Colab notebook.'
                  : setup.notebook.manualCopyHint
                    ? 'Open the shared notebook; if you don’t own it, use File → Save a copy in Drive.'
                    : `Notebook ready: ${setup.notebook.name || 'Visual Anagrams Batch Worker'}.`}{' '}
                Then: <strong>Runtime → Change runtime type</strong> (A100 + High-RAM) →{' '}
                <strong>Runtime → Run all</strong> → allow Google Drive access if prompted → leave it
                running.
              </>
            ) : null}
          </p>
        ) : null}
      </section>
    </div>
  );
}
