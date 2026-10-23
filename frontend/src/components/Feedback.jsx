// In-app replacement for the browser's native alert() / confirm() pop-ups.
//   const { confirm, toast } = useFeedback();
//   toast('Saved!', 'success');                       // 'success' | 'error' | 'info'
//   if (await confirm({ title, message, confirmLabel, tone: 'danger', typed: 'DELETE' })) { ... }
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import './Feedback.css';

const FeedbackCtx = createContext({
  toast: () => {},
  confirm: async () => false,
  choose: async () => null,
});
export const useFeedback = () => useContext(FeedbackCtx);

const ICONS = { success: '✓', error: '!', info: 'i', danger: '!', default: '?' };

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [typedValue, setTypedValue] = useState('');
  const resolver = useRef(null);
  const confirmBtnRef = useRef(null);
  const cancelBtnRef = useRef(null);

  const dismiss = useCallback((id) => setToasts((l) => l.filter((t) => t.id !== id)), []);

  const toast = useCallback((message, tone = 'info') => {
    if (!message) return;
    const id = Math.random().toString(36).slice(2);
    setToasts((l) => [...l.slice(-3), { id, message: String(message), tone }]);
    setTimeout(() => dismiss(id), tone === 'error' ? 5500 : 3800);
  }, [dismiss]);

  const confirm = useCallback((opts = {}) => new Promise((resolve) => {
    resolver.current?.(false);          // never leave an earlier promise hanging
    resolver.current = resolve;
    setTypedValue('');
    setDialog(opts);
  }), []);

  // choose({ title, message, options: [{ value, label, tone }] }) -> value of the clicked option, or null if dismissed
  const choose = useCallback((opts = {}) => new Promise((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setTypedValue('');
    setDialog({ ...opts, multi: true });
  }), []);

  const close = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setDialog(null);
  }, []);

  const typedOk = !dialog?.typed || typedValue === dialog.typed;

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close(dialog.multi ? null : false);
      if (e.key === 'Enter' && !dialog.multi && typedOk && document.activeElement?.tagName !== 'BUTTON') close(true);
    };
    window.addEventListener('keydown', onKey);
    // Dangerous actions focus "Cancel" first so a stray Enter can't destroy anything
    const t = setTimeout(() => {
      if (dialog.typed || dialog.multi) return;
      (dialog.tone === 'danger' ? cancelBtnRef : confirmBtnRef).current?.focus();
    }, 30);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [dialog, typedOk, close]);

  const value = useMemo(() => ({ toast, confirm, choose }), [toast, confirm, choose]);
  const tone = dialog?.tone === 'danger' ? 'danger' : 'default';

  return (
    <FeedbackCtx.Provider value={value}>
      {children}

      <div className="fb-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`fb-toast ${t.tone}`}>
            <span className="fb-toast-icon" aria-hidden="true">{ICONS[t.tone] || ICONS.info}</span>
            <span className="fb-toast-text">{t.message}</span>
            <button type="button" className="fb-toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>

      {dialog && (
        <div className="fb-overlay" onMouseDown={(e) => e.target === e.currentTarget && close(dialog.multi ? null : false)}>
          <div className={`fb-dialog ${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="fb-title">
            <div className={`fb-dialog-icon ${tone}`} aria-hidden="true">{ICONS[tone]}</div>
            <h3 id="fb-title">{dialog.title || 'Are you sure?'}</h3>
            {dialog.message && <p className="fb-dialog-msg">{dialog.message}</p>}
            {dialog.typed && (
              <label className="fb-typed">
                <span>Type <b>{dialog.typed}</b> to confirm</span>
                <input value={typedValue} onChange={(e) => setTypedValue(e.target.value)} autoFocus autoComplete="off" />
              </label>
            )}
            {dialog.multi ? (
              <div className="fb-dialog-actions stack">
                {(dialog.options || []).map((o, i) => (
                  <button key={o.value} type="button" autoFocus={i === 0} className={`fb-btn ${o.tone || 'ghost'}`} onClick={() => close(o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="fb-dialog-actions">
                <button type="button" ref={cancelBtnRef} className="fb-btn ghost" onClick={() => close(false)}>
                  {dialog.cancelLabel || 'Cancel'}
                </button>
                <button type="button" ref={confirmBtnRef} className={`fb-btn ${tone}`} disabled={!typedOk} onClick={() => close(true)}>
                  {dialog.confirmLabel || 'Confirm'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </FeedbackCtx.Provider>
  );
}
