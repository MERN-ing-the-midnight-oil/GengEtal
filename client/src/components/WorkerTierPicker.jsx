import { useEffect, useState } from 'react';

export default function WorkerTierPicker({
  workerTier,
  generation,
  notebook,
  onTierChange,
  onGenerationChange,
  onSaveNotebookUrl,
  busy = false,
}) {
  const [url, setUrl] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);
  const [savingGen, setSavingGen] = useState(false);
  const [error, setError] = useState('');
  const [resolution, setResolution] = useState(generation?.resolution || '1024');
  const [steps, setSteps] = useState(generation?.num_inference_steps || 30);

  const tier = workerTier?.tier || 'pro';
  const needsFreeLink = tier === 'free' && !notebook?.ready;
  const stepPresets = generation?.stepPresets || [15, 20, 30];

  useEffect(() => {
    if (generation?.resolution) setResolution(generation.resolution);
    if (generation?.num_inference_steps) setSteps(generation.num_inference_steps);
  }, [generation?.resolution, generation?.num_inference_steps]);

  async function selectTier(next) {
    if (busy || next === tier) return;
    setError('');
    try {
      await onTierChange(next);
    } catch (err) {
      setError(err.message || 'Could not switch tier');
    }
  }

  async function persistGeneration(next) {
    if (!onGenerationChange) return;
    setSavingGen(true);
    setError('');
    try {
      await onGenerationChange(next);
    } catch (err) {
      setError(err.message || 'Could not save generation settings');
    } finally {
      setSavingGen(false);
    }
  }

  async function handleResolution(next) {
    if (tier === 'free' && next === '1024') return;
    setResolution(next);
    await persistGeneration({ resolution: next, num_inference_steps: steps });
  }

  async function handleSteps(next) {
    setSteps(next);
    await persistGeneration({ resolution, num_inference_steps: next });
  }

  async function handleSaveUrl(e) {
    e.preventDefault();
    if (!url.trim() || !onSaveNotebookUrl) return;
    setSavingUrl(true);
    setError('');
    try {
      await onSaveNotebookUrl(url.trim());
      setUrl('');
    } catch (err) {
      setError(err.message || 'Could not save notebook URL');
    } finally {
      setSavingUrl(false);
    }
  }

  return (
    <section className="panel tier-panel">
      <h2>Compute settings</h2>
      <p className="setup-note" style={{ marginTop: 0 }}>
        Stretch Colab units by picking a cheaper GPU and lighter per-job settings. Queued jobs
        pick up whatever is selected here when you click Add to Queue. Idle connected runtimes
        still burn units — when you’re done for the day, open the Colab tab and choose{' '}
        <strong>Runtime → Disconnect and delete runtime</strong> (or{' '}
        <strong>Runtime → Manage sessions</strong> and end the active session). Closing the
        browser tab alone is not enough.
      </p>

      <h3 className="tier-subtitle">1. Worker GPU</h3>
      <div className="tier-toggle" role="group" aria-label="Worker tier">
        <button
          type="button"
          className={`tier-option${tier === 'free' ? ' is-active' : ''}`}
          onClick={() => selectTier('free')}
          disabled={busy || savingGen}
          aria-pressed={tier === 'free'}
        >
          <strong>Free / T4</strong>
          <span>Cheapest GPU · best unit stretch</span>
        </button>
        <button
          type="button"
          className={`tier-option${tier === 'pro' ? ' is-active' : ''}`}
          onClick={() => selectTier('pro')}
          disabled={busy || savingGen}
          aria-pressed={tier === 'pro'}
        >
          <strong>Pro / A100</strong>
          <span>Faster · uses units quickly</span>
        </button>
      </div>
      {workerTier?.detail ? <p className="tier-detail">{workerTier.detail}</p> : null}

      <h3 className="tier-subtitle">2. Per-job quality</h3>
      <p className="setup-note">
        Smaller images and fewer diffusion steps finish sooner, so each job costs less. Waiting
        in the app queue does not save units by itself.
      </p>

      <div className="gen-settings">
        <div className="gen-block">
          <span className="gen-label">Output size</span>
          <div className="tier-toggle compact" role="group" aria-label="Output size">
            <button
              type="button"
              className={`tier-option${resolution === '256' ? ' is-active' : ''}`}
              onClick={() => handleResolution('256')}
              disabled={busy || savingGen}
              aria-pressed={resolution === '256'}
            >
              <strong>256×256</strong>
              <span>Thrifty</span>
            </button>
            <button
              type="button"
              className={`tier-option${resolution === '1024' ? ' is-active' : ''}`}
              onClick={() => handleResolution('1024')}
              disabled={busy || savingGen || tier === 'free'}
              aria-pressed={resolution === '1024'}
              title={tier === 'free' ? 'Free / T4 worker is capped at 256×256' : undefined}
            >
              <strong>1024×1024</strong>
              <span>{tier === 'free' ? 'Needs Pro / A100' : 'Higher quality'}</span>
            </button>
          </div>
        </div>

        <div className="gen-block">
          <span className="gen-label">Diffusion steps</span>
          <div className="step-toggle" role="group" aria-label="Diffusion steps">
            {stepPresets.map((n) => (
              <button
                key={n}
                type="button"
                className={`step-option${steps === n ? ' is-active' : ''}`}
                onClick={() => handleSteps(n)}
                disabled={busy || savingGen}
                aria-pressed={steps === n}
              >
                <strong>{n}</strong>
                <span>{n <= 15 ? 'Fast' : n <= 20 ? 'Balanced' : 'Quality'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {needsFreeLink ? (
        <form className="tier-link-form" onSubmit={handleSaveUrl}>
          <p className="setup-note">
            Upload <code>{workerTier.notebookFile}</code> to Google Drive, open it in Colab,
            then paste the URL here so the banner opens the free worker.
          </p>
          <label htmlFor="free-notebook-url">Free-tier Colab URL</label>
          <div className="tier-link-row">
            <input
              id="free-notebook-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://colab.research.google.com/drive/…"
              disabled={savingUrl}
            />
            <button type="submit" className="primary" disabled={savingUrl || !url.trim()}>
              {savingUrl ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
