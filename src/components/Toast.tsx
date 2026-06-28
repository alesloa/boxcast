import { usePlayer } from "../store/player";

export function Toast() {
  const toast = usePlayer((s) => s.toast);
  const clearToast = usePlayer((s) => s.clearToast);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[84px] z-[60] flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-[10px] border border-border-strong bg-elev px-4 py-[10px] text-[12.5px] text-text shadow-[0_10px_30px_rgba(0,0,0,.5)]">
        <span>{toast.msg}</span>
        {toast.onUndo && (
          <button
            onClick={() => {
              toast.onUndo?.();
              clearToast();
            }}
            className="font-semibold text-[var(--c-green-text)] hover:underline"
          >
            Undo
          </button>
        )}
        <button
          onClick={clearToast}
          aria-label="Dismiss"
          className="grid h-5 w-5 place-items-center rounded text-faint hover:text-text"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
