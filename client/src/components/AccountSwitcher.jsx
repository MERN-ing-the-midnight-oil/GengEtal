import { useEffect, useRef, useState } from 'react';

function accountLabel(account) {
  if (!account) return 'Google account';
  return account.email || account.displayName || 'Google account';
}

export default function AccountSwitcher({
  googleAccount,
  googleAccounts,
  onSwitchAccount,
  switching = false,
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef(null);

  const accounts = googleAccounts?.accounts || [];
  const active = googleAccount || accounts.find((a) => a.active) || null;

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function handleSwitch(accountId) {
    if (!accountId || accountId === active?.id) {
      setOpen(false);
      return;
    }
    setError('');
    try {
      await onSwitchAccount(accountId);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="account-switcher" ref={rootRef}>
      <button
        type="button"
        className="account-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
      >
        <span className="account-switcher-label">
          <span className="account-switcher-kicker">Google / Colab</span>
          <span className="account-switcher-email">{accountLabel(active)}</span>
        </span>
        <span className="account-switcher-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div className="account-switcher-menu" role="menu">
          <p className="account-switcher-hint">
            Colab must be signed in as the same Google account. After switching, disconnect
            the old runtime and open this account’s notebook → Run all.
          </p>

          <ul className="account-switcher-list">
            {accounts.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  role="menuitem"
                  className={
                    account.active
                      ? 'account-switcher-item active'
                      : 'account-switcher-item'
                  }
                  disabled={switching || account.active}
                  onClick={() => handleSwitch(account.id)}
                >
                  <span>{accountLabel(account)}</span>
                  {account.active ? <span className="account-badge">Active</span> : null}
                </button>
              </li>
            ))}
          </ul>

          <a
            className="account-switcher-add"
            href="/api/setup/auth/google?select_account=1"
            role="menuitem"
          >
            Add another Google account…
          </a>

          {error ? <p className="form-error account-switcher-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
