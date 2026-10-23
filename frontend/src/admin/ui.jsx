// Shared admin UI kit: toasts, confirm dialogs (with optional reason / typed confirmation), modal,
// cards, stat tiles, badges, pagination and formatting helpers.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { parseServerDate } from '../utils/time';

// ── formatting ──────────────────────────────────────────────────────────────
export const fmtNum = (n) => (n ?? 0).toLocaleString();
export const fmtDate = (ts) => parseServerDate(ts)?.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) ?? '—';
export const fmtDateTime = (ts) => parseServerDate(ts)?.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) ?? '—';
export const fmtDur = (s) => {
  s = Math.round(s || 0);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
export const timeAgo = (ts) => {
  const d = parseServerDate(ts);
  if (!d) return 'Never';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(ts);
};

export function useDebounce(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// ── toasts ──────────────────────────────────────────────────────────────────
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = 'good') => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, message, tone }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="a-toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`a-toast ${t.tone}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// ── modal ───────────────────────────────────────────────────────────────────
export function Modal({ open, title, onClose, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="a-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`a-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="a-modal-head">
          <h3>{title}</h3>
          <button className="a-icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="a-modal-body">{children}</div>
        {footer && <div className="a-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ── confirm dialog: confirm({ title, message, tone, confirmLabel, input, typed }) -> {value} | null ──
const ConfirmCtx = createContext(async () => null);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const [value, setValue] = useState('');
  const resolver = useRef(null);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve;
    setValue('');
    setState(opts);
  }), []);
  const close = (result) => { resolver.current?.(result); setState(null); };

  const needsTyped = state?.typed && value !== state.typed;
  const needsInput = state?.input?.required && !value.trim();
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} title={state?.title || 'Are you sure?'} onClose={() => close(null)}
        footer={<>
          <button className="a-btn ghost" onClick={() => close(null)}>Cancel</button>
          <button className={`a-btn ${state?.tone === 'danger' ? 'danger' : 'primary'}`}
            disabled={needsTyped || needsInput} onClick={() => close({ value: value.trim() })}>
            {state?.confirmLabel || 'Confirm'}
          </button>
        </>}>
        {state?.message && <p className="a-muted" style={{ marginTop: 0 }}>{state.message}</p>}
        {state?.input && (
          <label className="a-field">
            <span>{state.input.label}</span>
            <textarea className="a-textarea" rows={3} value={value} placeholder={state.input.placeholder}
              onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
        )}
        {state?.typed && (
          <label className="a-field">
            <span>Type <b>{state.typed}</b> to confirm</span>
            <input className="a-input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  );
}

// ── building blocks ─────────────────────────────────────────────────────────
export const Card = ({ title, subtitle, actions, children, flush, className = '' }) => (
  <section className={`a-card ${className}`}>
    {(title || actions) && (
      <header className="a-card-head">
        <div><h3>{title}</h3>{subtitle && <p className="a-muted">{subtitle}</p>}</div>
        {actions && <div className="a-row">{actions}</div>}
      </header>
    )}
    <div className={flush ? 'a-card-flush' : 'a-card-body'}>{children}</div>
  </section>
);

export function Stat({ label, value, sub, icon, tone = 'accent', delta, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`a-stat ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <span className={`a-stat-icon ${tone}`}><Icon name={icon} size={20} /></span>
      <span className="a-stat-main">
        <span className="a-stat-label">{label}</span>
        <span className="a-stat-value">{value}</span>
        {(sub || delta !== undefined) && (
          <span className="a-stat-sub">
            {delta !== undefined && delta !== null && (
              <b className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%</b>
            )}{' '}{sub}
          </span>
        )}
      </span>
    </Tag>
  );
}

export const Badge = ({ tone = 'neutral', children }) => <span className={`a-badge ${tone}`}>{children}</span>;

export const Avatar = ({ name = '?', size = 34 }) => (
  <span className="a-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
    {(name.trim()[0] || '?').toUpperCase()}
  </span>
);

export const Spinner = ({ label = 'Loading…' }) => <div className="a-spinner-wrap"><span className="a-spinner" />{label}</div>;

export const Empty = ({ icon = 'search', title, children }) => (
  <div className="a-empty"><Icon name={icon} size={30} /><b>{title}</b>{children && <p className="a-muted">{children}</p>}</div>
);

export const ErrorBox = ({ message, onRetry }) => (
  <div className="a-error">
    <span>{message}</span>{onRetry && <button className="a-btn sm ghost" onClick={onRetry}><Icon name="refresh" size={14} /> Retry</button>}
  </div>
);

export function Pagination({ meta, onPage }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <div className="a-pager">
      <span className="a-muted">{from}–{to} of {fmtNum(meta.total)}</span>
      <div className="a-row">
        <button className="a-btn sm ghost" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}><Icon name="left" size={14} /> Prev</button>
        <span className="a-muted">Page {meta.page} / {meta.pages}</span>
        <button className="a-btn sm ghost" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>Next <Icon name="right" size={14} /></button>
      </div>
    </div>
  );
}

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="a-tabs" role="tablist">
    {tabs.map((t) => (
      <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
        {t.label}{t.count ? <span className="a-tab-count">{t.count}</span> : null}
      </button>
    ))}
  </div>
);

export const Switch = ({ checked, onChange, disabled }) => (
  <button type="button" role="switch" aria-checked={checked} disabled={disabled}
    className={`a-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>
);

export const PageHeader = ({ title, subtitle, children }) => (
  <div className="a-page-head">
    <div><h1>{title}</h1>{subtitle && <p className="a-muted">{subtitle}</p>}</div>
    <div className="a-row wrap">{children}</div>
  </div>
);

// Small data-loading hook: { data, loading, error, reload }
export function useFetch(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    return Promise.resolve(fnRef.current())
      .then((data) => setState({ data, loading: false, error: '' }))
      .catch((e) => setState((s) => ({ ...s, loading: false, error: e?.response?.data?.message || e?.message || 'Failed to load' })));
  }, []); // eslint-disable-line
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);
  return useMemo(() => ({ ...state, reload: run }), [state, run]);
}
