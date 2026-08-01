import { useEffect, useState } from 'react';
import {
  armJobAlert,
  dismissJobAlert,
  getAlertState,
  subscribeJobAlerts,
  syncJobAlerts,
} from '../jobAlert.js';
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

function Icon({ children, label }) {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

function UsePromptsIcon() {
  return (
    <Icon>
      <path d="M8 6h11" />
      <path d="M8 12h11" />
      <path d="M8 18h11" />
      <path d="M4 6h.01" />
      <path d="M4 12h.01" />
      <path d="M4 18h.01" />
    </Icon>
  );
}

function DownloadIcon() {
  return (
    <Icon>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </Icon>
  );
}

function DeleteIcon() {
  return (
    <Icon>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </Icon>
  );
}

function AlertIcon({ ringing }) {
  return (
    <Icon>
      <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
      {ringing ? <path d="M18.5 4.5 20 3M5.5 4.5 4 3" /> : null}
    </Icon>
  );
}

function RotateIcon() {
  return (
    <Icon>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </Icon>
  );
}

function ShareIcon() {
  return (
    <Icon>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5 15.4 17.5" />
      <path d="M15.4 6.5 8.6 10.5" />
    </Icon>
  );
}

function InProgressPlaceholder({ status, colabAlive }) {
  if (!colabAlive) {
    return (
      <>
        <span className="placeholder-title">Colab may have closed</span>
        <span className="placeholder-hint">
          No recent worker heartbeat. Open the notebook and use Runtime → Run all.
        </span>
      </>
    );
  }

  const title =
    status === 'processing' ? 'Generating in Colab…' : 'Queued — waiting for Colab…';

  return (
    <>
      <span className="spinner" aria-hidden="true" />
      <span className="placeholder-title">{title}</span>
      <span className="placeholder-hint">
        This may take about ten minutes to generate.
      </span>
    </>
  );
}

export default function JobCard({
  job,
  onUsePrompts,
  onDelete,
  onPublish,
  onUnpublish,
  colabAlive = false,
  readOnly = false,
  friendLabel = null,
}) {
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [alertState, setAlertState] = useState(() => getAlertState(job.id));
  const stamp =
    job.published_at || job.completed_at || job.updated_at || job.created_at;
  const inProgress = job.status === 'pending' || job.status === 'processing';
  const canDownload = Boolean(job.has_image && job.image_url);
  const canPublish =
    !readOnly &&
    Boolean(onPublish || onUnpublish) &&
    job.status === 'completed' &&
    canDownload;
  const busy = deleting || downloading || publishing;
  const showAlertControl =
    !readOnly && (inProgress || alertState === 'ringing');
  const imageAlt = `${job.prompt_1} / ${job.prompt_2}`;

  useEffect(() => {
    setAlertState(getAlertState(job.id));
    return subscribeJobAlerts(() => setAlertState(getAlertState(job.id)));
  }, [job.id]);

  useEffect(() => {
    setRotated(false);
    setPreviewOpen(false);
  }, [job.id, job.image_url]);

  useEffect(() => {
    if (!previewOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') setPreviewOpen(false);
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [previewOpen]);

  function handleUsePrompts() {
    if (!onUsePrompts || busy) return;
    onUsePrompts({ prompt_1: job.prompt_1, prompt_2: job.prompt_2 });
  }

  function handleAlertToggle() {
    if (alertState === 'off') {
      armJobAlert(job.id);
      if (job.has_image) syncJobAlerts([job]);
    } else {
      dismissJobAlert(job.id);
    }
  }

  function handleRotate() {
    if (!canDownload || busy) return;
    setRotated((prev) => !prev);
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

  async function handlePublishToggle() {
    if (!canPublish || busy) return;
    setPublishing(true);
    try {
      if (job.published) {
        if (onUnpublish) await onUnpublish(job.id);
      } else if (onPublish) {
        await onPublish(job.id);
      }
    } catch (err) {
      console.error(err);
      window.alert(err.message || 'Could not update publish state');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
    <article className="job">
      {canDownload ? (
        <button
          type="button"
          className="job-image job-image-button"
          onClick={() => setPreviewOpen(true)}
          aria-label={`View full size: ${imageAlt}`}
        >
          <img
            src={job.image_url}
            alt={imageAlt}
            loading="lazy"
            className={rotated ? 'is-rotated' : undefined}
          />
        </button>
      ) : (
        <div className="job-image">
          <div className="placeholder">
            {job.status === 'failed' ? (
              job.error_message || 'Generation failed'
            ) : inProgress ? (
              <InProgressPlaceholder status={job.status} colabAlive={colabAlive} />
            ) : job.status === 'completed' ? (
              <>
                <span className="placeholder-title">Waiting for image…</span>
                <span className="placeholder-hint">
                  Colab finished the job, but the PNG hasn’t synced from Drive yet.
                  This usually updates within a minute.
                </span>
              </>
            ) : (
              'Image not synced yet'
            )}
          </div>
        </div>
      )}
      <div className="job-body">
        <div className="prompts">
          “{job.prompt_1}” <span className="swap">↔</span> “{job.prompt_2}”
        </div>
        <div className="meta">
          {readOnly ? (
            <span className="badge completed">friend</span>
          ) : (
            <span className={`badge ${job.status}`}>{job.status}</span>
          )}
          {job.published && !readOnly ? (
            <span className="badge published">published</span>
          ) : null}
          {friendLabel ? (
            <span className="friend-label">{friendLabel}</span>
          ) : null}
          <time dateTime={stamp}>{formatTime(stamp)}</time>
        </div>
        <div className="job-actions">
          <button
            type="button"
            className="watch-btn secondary"
            onClick={handleUsePrompts}
            disabled={busy || !onUsePrompts}
          >
            <UsePromptsIcon />
            Use prompts
          </button>
          {canDownload ? (
            <button
              type="button"
              className="watch-btn secondary icon-only"
              onClick={handleDownload}
              disabled={busy}
              aria-label={downloading ? 'Downloading' : 'Download'}
              title={downloading ? 'Downloading…' : 'Download'}
            >
              <DownloadIcon />
            </button>
          ) : null}
          {canDownload ? (
            <button
              type="button"
              className={`watch-btn secondary icon-only${rotated ? ' is-active' : ''}`}
              onClick={handleRotate}
              disabled={busy}
              aria-pressed={rotated}
              aria-label="Rotate 180 degrees"
              title="Rotate 180°"
            >
              <RotateIcon />
            </button>
          ) : null}
          {canPublish ? (
            <button
              type="button"
              className={`watch-btn secondary icon-only${job.published ? ' is-active' : ''}`}
              onClick={handlePublishToggle}
              disabled={busy}
              aria-pressed={Boolean(job.published)}
              aria-label={
                publishing
                  ? 'Updating publish'
                  : job.published
                    ? 'Unpublish from gallery'
                    : 'Publish to gallery'
              }
              title={
                publishing
                  ? 'Updating…'
                  : job.published
                    ? 'Unpublish'
                    : 'Publish to friends gallery'
              }
            >
              <ShareIcon />
            </button>
          ) : null}
          {!readOnly ? (
            <button
              type="button"
              className="watch-btn secondary icon-only"
              onClick={handleDelete}
              disabled={busy || !onDelete}
              aria-label={deleting ? 'Deleting' : 'Delete'}
              title={deleting ? 'Deleting…' : 'Delete'}
            >
              <DeleteIcon />
            </button>
          ) : null}
          {showAlertControl ? (
            <button
              type="button"
              className={`watch-btn secondary${alertState !== 'off' ? ' alert-armed' : ''}`}
              onClick={handleAlertToggle}
              disabled={busy}
              aria-pressed={alertState !== 'off'}
            >
              <AlertIcon ringing={alertState === 'ringing'} />
              {alertState === 'ringing'
                ? 'Stop alert'
                : alertState === 'armed'
                  ? 'Cancel alert'
                  : 'Alert me'}
            </button>
          ) : null}
        </div>
      </div>
    </article>
    {previewOpen && canDownload ? (
      <div
        className="image-modal"
        role="dialog"
        aria-modal="true"
        aria-label={imageAlt}
        onClick={() => setPreviewOpen(false)}
      >
        <div className="image-modal-toolbar" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`image-modal-btn${rotated ? ' is-active' : ''}`}
            aria-label="Rotate 180 degrees"
            aria-pressed={rotated}
            title="Rotate 180°"
            onClick={handleRotate}
          >
            <RotateIcon />
          </button>
          <button
            type="button"
            className="image-modal-btn"
            aria-label="Close image preview"
            title="Close"
            onClick={() => setPreviewOpen(false)}
          >
            ×
          </button>
        </div>
        <img
          src={job.image_url}
          alt={imageAlt}
          className={rotated ? 'is-rotated' : undefined}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    ) : null}
    </>
  );
}
