import { useState } from 'react';

export default function HfCredentialsForm({
  setup,
  onSaveCredentials,
  savingCredentials,
  error,
  compact = false,
}) {
  const hfReady = Boolean(setup?.secrets?.huggingface?.configured);
  const remembered = Boolean(setup?.secrets?.huggingface?.remembered);
  const [hfToken, setHfToken] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [formError, setFormError] = useState('');
  const [savedNote, setSavedNote] = useState('');

  async function handleSaveHf(e) {
    e.preventDefault();
    setFormError('');
    setSavedNote('');
    try {
      await onSaveCredentials({
        huggingface_token: hfToken.trim(),
        remember_me: rememberMe,
      });
      setHfToken('');
      setSavedNote(
        rememberMe
          ? 'Token saved on this machine and synced for Colab.'
          : 'Token kept for this session only (not written to disk). Synced for Colab if signed in.'
      );
    } catch (err) {
      setFormError(err.message);
    }
  }

  return (
    <form className="credentials-form" onSubmit={handleSaveHf}>
      <fieldset className="cred-block">
        <legend>
          <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
            Hugging Face
          </a>
        </legend>
        {!compact ? (
          <p className="field-help">
            Create a free account, accept the{' '}
            <a
              href="https://huggingface.co/DeepFloyd/IF-I-XL-v1.0"
              target="_blank"
              rel="noreferrer"
            >
              DeepFloyd IF license
            </a>
            , then paste a read access token. It’s synced to your Drive for Colab after you log in
            with Google.
            {hfReady
              ? ` ${remembered ? 'Saved' : 'Session'}: ${setup.secrets.huggingface.preview}`
              : ''}
          </p>
        ) : (
          <p className="field-help">
            Required by the Colab notebook (DeepFloyd). Synced to Drive as{' '}
            <code>secrets.json</code>.
            {hfReady
              ? ` ${remembered ? 'Saved' : 'Session'}: ${setup.secrets.huggingface.preview}`
              : ''}
          </p>
        )}
        <div className="field">
          <label htmlFor="hfToken">Access token</label>
          <input
            id="hfToken"
            type="password"
            value={hfToken}
            onChange={(e) => setHfToken(e.target.value)}
            placeholder={hfReady ? '•••••••• (leave blank to keep current token)' : 'hf_…'}
            autoComplete="off"
            required={!hfReady}
          />
        </div>
        <label className="remember-me">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <span>Remember me on this machine</span>
        </label>
      </fieldset>

      {(formError || error) && <p className="form-error">{formError || error}</p>}
      {savedNote && !formError ? <p className="form-ok">{savedNote}</p> : null}

      <button className="btn" type="submit" disabled={savingCredentials}>
        {savingCredentials ? 'Saving…' : hfReady ? 'Update token' : 'Save token'}
      </button>
    </form>
  );
}
