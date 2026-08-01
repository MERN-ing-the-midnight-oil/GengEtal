import { useEffect, useState } from 'react';

export default function JobForm({ onSubmit, disabled, stagedPrompts, burn }) {
  const [prompt1, setPrompt1] = useState('');
  const [prompt2, setPrompt2] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const estimate = burn?.estimate;
  const burnLevel =
    estimate?.expectedCu >= 8 ? 'is-high' : estimate?.expectedCu >= 4 ? 'is-mid' : 'is-low';

  useEffect(() => {
    if (!stagedPrompts) return;
    setPrompt1(stagedPrompts.prompt_1 || '');
    setPrompt2(stagedPrompts.prompt_2 || '');
    setError('');
  }, [stagedPrompts]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!prompt1.trim() || !prompt2.trim()) {
      setError('Both prompts are required.');
      return;
    }

    // Confirm before spending on moderate/high burn settings; low-burn still shows the banner above.
    if (estimate?.expectedCu >= 4) {
      const ok = window.confirm(
        [
          `Queue this job? Estimated compute burn: ${estimate.summary}`,
          `Typical range ${estimate.lowCu}–${estimate.highCu} CU with current settings.`,
          estimate.warning,
          burn?.jobsPerBudget != null
            ? `At this rate, ~${burn.jobsPerBudget} jobs fit in a ${estimate.calibration?.budgetUnits ?? '—'} CU budget.`
            : null,
        ]
          .filter(Boolean)
          .join('\n\n')
      );
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ prompt_1: prompt1.trim(), prompt_2: prompt2.trim() });
      setPrompt1('');
      setPrompt2('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      {estimate ? (
        <div className={`burn-preflight ${burnLevel}`} role="status">
          <strong>Before you queue: {estimate.summary}</strong>
          <span>
            Typical range {estimate.lowCu}–{estimate.highCu} CU. {estimate.warning}
            {burn?.jobsPerBudget != null
              ? ` About ${burn.jobsPerBudget} jobs left in a ${estimate.calibration?.budgetUnits ?? '—'} CU budget at this rate.`
              : ''}
          </span>
        </div>
      ) : null}
      <div className="form-row">
        <div className="field">
          <label htmlFor="prompt1">Prompt 1</label>
          <input
            id="prompt1"
            value={prompt1}
            onChange={(e) => setPrompt1(e.target.value)}
            placeholder='e.g. "an oil painting of a village"'
            disabled={disabled || submitting}
          />
        </div>
        <div className="field">
          <label htmlFor="prompt2">Prompt 2</label>
          <input
            id="prompt2"
            value={prompt2}
            onChange={(e) => setPrompt2(e.target.value)}
            placeholder='e.g. "an oil painting of a horse"'
            disabled={disabled || submitting}
          />
        </div>
        <button className="btn" type="submit" disabled={disabled || submitting}>
          {submitting ? 'Adding…' : 'Add to Queue'}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}

      <details className="prompt-tips">
        <summary>The art of choosing prompts</summary>
        <div className="prompt-tips-body">
          <p>
            This app generates a two-view illusion (
            <code>identity</code> ↔ <code>rotate_180</code>
            ). Tips from the original{' '}
            <a
              href="https://github.com/dangeng/visual_anagrams"
              target="_blank"
              rel="noreferrer"
            >
              Visual Anagrams
            </a>{' '}
            authors:
          </p>
          <ul>
            <li>
              Styles such as <em>“a photo of”</em> tend to be harder — realism is a tough
              constraint (but it can still work).
            </li>
            <li>
              Styles such as <em>“an oil painting of”</em> often do better — there’s more freedom
              in how the subject can be depicted.
            </li>
            <li>
              Subjects with flexible depiction tend to work well: <em>“houseplants”</em>,{' '}
              <em>“wine and cheese”</em>, <em>“a kitchen”</em>.
            </li>
            <li>
              Keep the subject easily recognizable. Illusions are much better when they’re
              instantly understandable.
            </li>
            <li>
              Faces make strong “hidden” subjects (e.g. <em>“an old man”</em>,{' '}
              <em>“marilyn monroe”</em>) — people are especially good at picking out faces.
            </li>
            <li>
              3-view and 4-view illusions are considerably harder (this app sticks to 2 views).
            </li>
            <li>
              Intuition fails often: prompts that “should” work sometimes don’t, and vice versa.
              Exploration is key.
            </li>
          </ul>
        </div>
      </details>
    </form>
  );
}