export default function WatchColabButton({
  href,
  label = 'Watch progress in Colab →',
  variant = 'primary',
  disabled = false,
  onOpen,
}) {
  if (!href || disabled) {
    return (
      <button type="button" className={`watch-btn ${variant}`} disabled>
        {label}
      </button>
    );
  }

  return (
    <a
      className={`watch-btn ${variant}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => {
        onOpen?.();
      }}
    >
      {label}
    </a>
  );
}
