import React, { useCallback, useEffect, useState } from 'react';
import API from '../services/api';
import { formatDateTime } from '../utils/time';
import { readData, refreshData, writeData } from '../utils/dataCache';
import { useFeedback } from './Feedback';
import Icon from './Icon';
import { formatAIMessage } from './aiFormat';
import './Engage.css';

const KIND = { workout: 'Workout plan', meal: 'Meal plan', other: 'Plan' };

// Profile card: every coach plan the member pressed "Save plan" on.
export default function SavedPlans() {
  const { toast, confirm } = useFeedback();
  const [plans, setPlans] = useState(() => readData('plans')?.data?.plans || null);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try { const d = await refreshData('plans'); setPlans(d.plans || []); } catch { setPlans((p) => p || []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (p) => {
    if (!(await confirm({ title: 'Delete this plan?', message: `“${p.title}” will be removed from your profile.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await API.delete(`/plans/${p.id}`); setPlans((prev) => prev.filter((x) => x.id !== p.id)); writeData('plans', { plans: (readData('plans')?.data?.plans || []).filter((x) => x.id !== p.id) }); toast('Plan removed.', 'success'); }
    catch { toast('Could not delete the plan.', 'error'); }
  };
  const copy = async (p) => {
    try { await navigator.clipboard.writeText(p.content); toast('Plan copied.', 'success'); } catch { toast('Copy is not available here.', 'error'); }
  };

  return (
    <div className="prof-card card prof-wide">
      <div className="prof-card-header">
        <span className="prof-card-icon"><Icon name="bookmark" size={20} /></span>
        <div>
          <div className="prof-card-title">Saved plans</div>
          <div className="prof-card-sub">Workout and meal plans saved from your AI coach</div>
        </div>
      </div>
      {plans === null ? <div className="sk" style={{ height: 56 }} />
        : plans.length === 0 ? <p className="prof-hint-text">Ask the AI coach for a workout or meal plan, then tap “Save plan” under its reply.</p>
        : (
          <div className="sp-list">
            {plans.map((p) => (
              <div key={p.id} className={`sp-item ${p.kind}`}>
                <button type="button" className="sp-head" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                  <span className="sp-kind">{KIND[p.kind] || 'Plan'}</span>
                  <strong>{p.title}</strong>
                  <small>{formatDateTime(p.created_at)}</small>
                  <Icon name={open === p.id ? 'chevronDown' : 'chevronRight'} size={16} />
                </button>
                {open === p.id && (
                  <div className="sp-body">
                    <div className="sp-text">{formatAIMessage(p.content)}</div>
                    <div className="sp-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(p)}><Icon name="copy" size={15} /> Copy</button>
                      <button type="button" className="btn btn-ghost btn-sm sp-del" onClick={() => remove(p)}><Icon name="trash" size={15} /> Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
