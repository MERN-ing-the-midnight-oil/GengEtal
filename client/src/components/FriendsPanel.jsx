import { useEffect, useState } from 'react';

function Icon({ children, className = 'friends-icon' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function FriendsIcon() {
  return (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

function LinkIcon() {
  return (
    <Icon>
      <path d="M10 13a5 5 0 0 0 7.54.54l1.92-1.92a5 5 0 0 0-7.07-7.07l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.54-.54L4.54 12.38a5 5 0 0 0 7.07 7.07l1.1-1.1" />
    </Icon>
  );
}

function CopyIcon() {
  return (
    <Icon>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  );
}

function UserPlusIcon() {
  return (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6" />
      <path d="M22 11h-6" />
    </Icon>
  );
}

function PersonIcon() {
  return (
    <Icon className="friends-icon friends-icon-sm">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  );
}

function EmptyFriendsIcon() {
  return (
    <Icon className="friends-icon friends-empty-icon">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

function friendInitials(friend) {
  const label = String(friend.displayName || friend.email || '?').trim();
  const parts = label.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

export default function FriendsPanel({
  share,
  friends = [],
  onRefreshShare,
  onAddFriend,
  onRemoveFriend,
  busy = false,
}) {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const [removingId, setRemovingId] = useState('');

  useEffect(() => {
    if (!share && onRefreshShare) onRefreshShare();
  }, [share, onRefreshShare]);

  async function handleCopy() {
    if (!share?.galleryLink) {
      setError('Gallery link is not ready yet. Try again in a moment.');
      if (onRefreshShare) await onRefreshShare();
      return;
    }
    setCopying(true);
    setError('');
    setNotice('');
    try {
      await navigator.clipboard.writeText(share.galleryLink);
      setNotice('Gallery link copied. Friends paste it under Add friend.');
    } catch {
      setError('Could not copy automatically — select the link and copy it.');
    } finally {
      setCopying(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!link.trim() || !onAddFriend) return;
    setAdding(true);
    setError('');
    setNotice('');
    try {
      await onAddFriend(link.trim());
      setLink('');
      setNotice('Friend added. Open the Friends gallery to browse.');
    } catch (err) {
      setError(err.message || 'Could not add friend');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(friendId) {
    if (!onRemoveFriend) return;
    if (!window.confirm('Remove this friend gallery?')) return;
    setRemovingId(friendId);
    setError('');
    try {
      await onRemoveFriend(friendId);
    } catch (err) {
      setError(err.message || 'Could not remove friend');
    } finally {
      setRemovingId('');
    }
  }

  const ownerLabel =
    share?.owner?.email || share?.owner?.displayName || 'your Google account';
  const publishedCount =
    typeof share?.itemCount === 'number' ? share.itemCount : null;
  const summaryLine =
    friends.length > 0
      ? `${friends.length} friend${friends.length === 1 ? '' : 's'}`
      : 'Nobody has shared their gallery with you yet';

  return (
    <details className="friends-panel">
      <summary>
        <span className="friends-summary-main">
          <FriendsIcon />
          <span>Friends &amp; public gallery</span>
        </span>
        <span className="friends-summary-meta">{summaryLine}</span>
      </summary>

      <div className="friends-panel-body">
        <section className="friends-section friends-roster" aria-labelledby="your-friends-heading">
          <h3 id="your-friends-heading" className="friends-section-title">
            <FriendsIcon />
            Your friends
          </h3>

          {friends.length > 0 ? (
            <>
              <p className="friends-section-note">
                Galleries shared with you — switch to the Friends tab above to browse
                their published images.
              </p>
              <ul className="friends-list">
                {friends.map((friend) => (
                  <li key={friend.id}>
                    <div className="friends-list-main">
                      <span className="friends-avatar" aria-hidden="true">
                        {friendInitials(friend)}
                      </span>
                      <div>
                        <strong>
                          {friend.displayName || friend.email || 'Friend'}
                        </strong>
                        {friend.email && friend.displayName ? (
                          <span className="friends-muted">{friend.email}</span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => handleRemove(friend.id)}
                      disabled={busy || removingId === friend.id}
                    >
                      {removingId === friend.id ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="friends-empty" role="status">
              <EmptyFriendsIcon />
              <p>
                <strong>Nobody has shared their gallery with you yet</strong>
                Ask a friend for their gallery link, then paste it below to add them.
              </p>
            </div>
          )}
        </section>

        <section className="friends-section" aria-labelledby="your-link-heading">
          <h3 id="your-link-heading" className="friends-section-title">
            <LinkIcon />
            Your gallery link
          </h3>
          <p className="friends-section-note">
            Share this with friends so they can add you. Publish images from a job
            card first — currently{' '}
            <strong>
              {publishedCount == null
                ? '…'
                : `${publishedCount} published`}
            </strong>
            {' '}
            as {ownerLabel}.
          </p>
          <div className="friends-share-row">
            <input
              type="text"
              readOnly
              value={share?.galleryLink || 'Preparing gallery link…'}
              aria-label="Your gallery link"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className="btn friends-action-btn"
              onClick={handleCopy}
              disabled={busy || copying || !share?.galleryLink}
            >
              <CopyIcon />
              {copying ? 'Copying…' : 'Copy link'}
            </button>
          </div>
        </section>

        <section className="friends-section" aria-labelledby="add-friend-heading">
          <h3 id="add-friend-heading" className="friends-section-title">
            <UserPlusIcon />
            Add a friend
          </h3>
          <form className="friends-add" onSubmit={handleAdd}>
            <label htmlFor="friend-gallery-link" className="visually-hidden">
              Friend gallery link
            </label>
            <div className="friends-share-row">
              <input
                id="friend-gallery-link"
                type="url"
                placeholder="Paste their gallery link…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                disabled={busy || adding}
              />
              <button
                type="submit"
                className="btn secondary-btn friends-action-btn"
                disabled={busy || adding || !link.trim()}
              >
                <PersonIcon />
                {adding ? 'Adding…' : 'Add friend'}
              </button>
            </div>
          </form>
        </section>

        {notice ? (
          <p className="friends-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
