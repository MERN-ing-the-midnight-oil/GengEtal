import { useState } from 'react';
import WatchColabButton from './WatchColabButton.jsx';

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function slugPart(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function downloadFilename(job) {
  const slug = [slugPart(job.prompt_1), slugPart(job.prompt_2)].filter(Boolean).join('_');
  return `${slug || job.id}.png`;
}

export default function JobCard({ job, notebookUrl, onOpenNotebook, onReroll, onDelete }) {
  const [rerolling, setRerolling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const stamp = job.completed_at || job.updated_at || job.created_at;
  const inProgress = job.status === 'pending' || job.status === 'processing';
  const canDownload = Boolean(job.has_image && job.image_url);
  const busy = rerolling || deleting || downloading;

  async function handleReroll() {
    if (!onReroll || busy) return;
    setRerolling(true);
    try {
      await onReroll({ prompt_1: job.prompt_1, prompt_2: job.prompt_2 });
    } catch (err) {
      console.error(err);
    } finally {
      setRerolling(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || busy) return;
    if (!window.confirm('Delete this job?')) return;
    setDeleting(true);
    try {
      await onDelete(job.id);
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDownload() {
    if (!canDownload || busy) return;
    setDownloading(true);
    try {
      const res = await fetch(job.image_url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFilename(job);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <article className="job">
      <div className="job-image">
        {canDownload ? (
          <img src={job.image_url} alt={`${job.prompt_1} / ${job.prompt_2}`} loading="lazy" />
        ) : (
          <div className="placeholder">
            {job.status === 'failed' ? (
              job.error_message || 'Generation failed'
            ) : job.status === 'processing' ? (
              'Generating in Colab…'
            ) : job.status === 'pending' ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span className="placeholder-title">Queued — waiting for Colab…</span>
                <span className="placeholder-hint">
                  This may take about half an hour to generate.
                </span>
              </>
            ) : (
              'Image not synced yet'
            )}
          </div>
        )}
      </div>
      <div className="job-body">
        <div className="prompts">
          “{job.prompt_1}” <span className="swap">↔</span> “{job.prompt_2}”
        </div>
        <div className="meta">
          <span className={`badge ${job.status}`}>{job.status}</span>
          <time dateTime={stamp}>{formatTime(stamp)}</time>
        </div>
        <div className="job-actions">
          <button
            type="button"
            className="watch-btn secondary"
            onClick={handleReroll}
            disabled={busy || !onReroll}
          >
            {rerolling ? 'Rerolling…' : 'Reroll'}
          </button>
          {canDownload ? (
            <button
              type="button"
              className="watch-btn secondary"
              onClick={handleDownload}
              disabled={busy}
            >
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          ) : null}
          <button
            type="button"
            className="watch-btn secondary"
            onClick={handleDelete}
            disabled={busy || !onDelete}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          {inProgress && notebookUrl ? (
            <WatchColabButton
              href={notebookUrl}
              label={
                job.status === 'processing'
                  ? 'Watch this job in Colab →'
                  : 'Open Colab notebook →'
              }
              variant="secondary"
              onOpen={onOpenNotebook}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
