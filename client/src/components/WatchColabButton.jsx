/** Reused across every “Open Colab” control so clicks focus one tab. */
export const COLAB_WINDOW_NAME = 'ambiglyph-colab';

export function openColabNotebook(href) {
  if (!href) return null;
  return window.open(href, COLAB_WINDOW_NAME);
}

export default function WatchColabButton({
  href,
  label = 'Watch progress in Colab →',
  variant = 'primary',
  className = '',
  disabled = false,
  onOpen,
}) {
  const classes = ['watch-btn', variant, className].filter(Boolean).join(' ');

  if (!href || disabled) {
    return (
      <button type="button" className={classes} disabled>
        {label}
      </button>
    );
  }

  return (
    <a
      className={classes}
      href={href}
      target={COLAB_WINDOW_NAME}
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        openColabNotebook(href);
        onOpen?.();
      }}
    >
      {label}
    </a>
  );
}
