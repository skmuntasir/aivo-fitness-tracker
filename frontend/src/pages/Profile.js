import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './Profile.css';
import API from '../services/api';
import Icon from '../components/Icon';
import { useFeedback } from '../components/Feedback';
import BackButton from '../components/BackButton';
import { BadgeGrid } from '../components/Badges';
import SavedPlans from '../components/SavedPlans';
import { readData, refreshData, writeData } from '../utils/dataCache';
import WorkoutNames from '../components/WorkoutNames';
import ThemeToggle from '../components/ThemeToggle';


// Compress image to base64 (max 400px, quality 0.75)
const compressImage = (file) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 400;
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
      else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// Convert cm to feet/inches display string e.g. 177.8 → "5'10""
const cmToFeetInches = (cm) => {
  if (!cm) return '—';
  const totalInches = Math.round(Number(cm) / 2.54);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
};

const Profile = () => {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const [userData, setUserData] = useState(() => readData('profile')?.data?.user || null);       // last saved copy shows instantly
  const [healthMetrics, setHealthMetrics] = useState(() => readData('profile')?.data?.metrics || null);
  const [loading, setLoading] = useState(() => !readData('profile'));
  const [error, setError] = useState(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [editForm, setEditForm] = useState({});
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // Profile picture is stored per-user using their ID as the localStorage key
  const getUserId = () => {
    try { return JSON.parse(localStorage.getItem('user'))?.id || null; } catch { return null; }
  };
  const [profilePic, setProfilePic] = useState(() => {
    const uid = getUserId();
    return uid ? (localStorage.getItem(`profilePic_${uid}`) || null) : null;
  });
  const [picUploading, setPicUploading] = useState(false);
  const [badges, setBadges] = useState(() => readData('badges')?.data || null);
  const fileInputRef = useRef(null);

  useEffect(() => { fetchUserData(); }, []);
  useEffect(() => { refreshData('badges').then(setBadges).catch(() => setBadges((b) => b || { badges: [], earned_count: 0, total: 0 })); }, []);

  const fetchUserData = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setError('Authentication token missing. Please log in again.'); setLoading(false); return; }
    try {
      setError(null);
      const { user, metrics } = await refreshData('profile');   // shared request; the spinner only shows on the very first visit
      setUserData(user);
      setHealthMetrics(metrics || null);
      const uid = user._id || user.id || getUserId();
      const picKey = uid ? `profilePic_${uid}` : 'profilePic';
      const pic = user.profile_picture || localStorage.getItem(picKey) || null;
      setProfilePic(pic);
      if (user.profile_picture) localStorage.setItem(picKey, user.profile_picture);
    } catch (err) {
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/login'; return;
      }
      if (!userData) setError(err.userMessage || err.response?.data?.message || 'Failed to load user data.');   // a saved copy stays on screen if the refresh fails
    } finally { setLoading(false); }
  };

  const parseJoinedDate = () => {
    const rawDate = userData?.created_at || userData?.joined_at;
    if (!rawDate) return 'recently';
    const date = new Date(rawDate);
    return isNaN(date.getTime()) ? 'recently' : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const goalProgress = () => {
    const target = Number(userData?.target_weight);
    const current = Number(userData?.weight);
    const start = Number(userData?.start_weight || userData?.weight);
    if (!target || !current) return 0;
    if (start <= target) return Math.min(100, Math.round(((current - start) / (target - start)) * 100));
    return Math.min(100, Math.max(0, Math.round(((start - current) / (start - target)) * 100)));
  };

  const weeklyCalories = healthMetrics?.bmr ? Math.round(healthMetrics.bmr * 7) : null;

  // ── Profile Picture Upload ────────────────────────────────────────────────
  const handlePicChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPicUploading(true);
    try {
      const base64 = await compressImage(file);
      setProfilePic(base64);
      const uid = userData?._id || userData?.id || getUserId();
      const picKey = uid ? `profilePic_${uid}` : 'profilePic';
      localStorage.setItem(picKey, base64);
      await API.put('/auth/profile', { profile_picture: base64 });
      const saved = readData('profile')?.data;
      if (saved?.user) writeData('profile', { ...saved, user: { ...saved.user, profile_picture: base64 } });
    } catch (err) {
      console.error('Picture upload failed', err);
      toast('Failed to upload photo. Please try a smaller image.', 'error');
    } finally {
      setPicUploading(false);
    }
  };

  // ── Edit Account ──────────────────────────────────────────────────────────
  const openEdit = () => {
    setEditForm({
      full_name: userData?.full_name || '',
      age: userData?.age || '',
      weight: userData?.weight ? Math.round(userData.weight) : '',
      height: userData?.height || '',
      target_weight: userData?.target_weight ? Math.round(userData.target_weight) : '',
      fitness_level: userData?.fitness_level || '',
      preferred_units: userData?.preferred_units || 'metric',
    });
    setShowEditModal(true);
  };

  const handleEditSave = async () => {
    setEditLoading(true);
    try {
      const payload = { ...editForm };
      // weight & target_weight → always store as integer (no decimal drift)
      ['weight', 'target_weight'].forEach(k => {
        if (payload[k] !== undefined && payload[k] !== '') {
          payload[k] = Math.round(parseFloat(payload[k]));
        }
      });
      // height stays float in cm (needed for BMI) — set via dropdown so already clean
      if (payload.age !== undefined && payload.age !== '') payload.age = parseInt(payload.age);
      const res = await API.put('/auth/profile', payload);
      if (res.data.success) {
        setShowEditModal(false);
        await fetchUserData();
        toast('Profile updated.', 'success');
      } else { toast(res.data.message || 'Update failed.', 'error'); }
    } catch (err) { toast(err.response?.data?.message || 'Update failed.', 'error'); }
    finally { setEditLoading(false); }
  };

  // ── Delete Account ────────────────────────────────────────────────────────
  const handleDeleteAccount = async () => {
    if (deleteInput !== 'DELETE') { toast('Please type DELETE to confirm.', 'error'); return; }
    setDeleteLoading(true);
    try {
      const res = await API.delete('/auth/account');
      if (res.data.success) {
        localStorage.removeItem('token'); localStorage.removeItem('user');
        window.location.href = '/login';
      } else { toast(res.data.message || 'Deletion failed.', 'error'); }
    } catch (err) { toast(err.response?.data?.message || 'Deletion failed.', 'error'); }
    finally { setDeleteLoading(false); }
  };

  if (loading) return (
    <div className="profile-page">
      <div className="home-bg-gradient"></div>
      <div className="home-bg-orbs"><div className="orb orb-1"></div><div className="orb orb-2"></div><div className="orb orb-3"></div></div>
      <div className="profile-loading"><div className="loading-spinner"/><p>Loading your profile</p></div>
    </div>
  );

  if (error) return (
    <div className="profile-page">
      <div className="home-bg-gradient"></div>
      <div className="home-bg-orbs"><div className="orb orb-1"></div><div className="orb orb-2"></div><div className="orb orb-3"></div></div>
      <BackButton />
      <div className="profile-error card">
        <h2>Something went wrong</h2><p>{error}</p>
        <div style={{display:'flex',gap:12,marginTop:16}}>
          <button className="prof-btn-primary" onClick={fetchUserData}>Try Again</button>
          <button className="prof-btn-secondary" onClick={() => navigate('/home')}>Go Home</button>
        </div>
      </div>
    </div>
  );

  const gp = goalProgress();

  return (
    <div className="profile-page">
      <div className="profile-content">
        {/* ── HERO CARD ── */}
        <div className="prof-hero card">
          <div className="prof-hero-inner">
            {/* Avatar with upload */}
            <div className="prof-avatar-wrap">
              <div className="prof-avatar" onClick={() => fileInputRef.current?.click()}>
                {profilePic
                  ? <img src={profilePic} alt="Profile" className="prof-avatar-img"/>
                  : <span className="prof-avatar-initial">{userData?.full_name?.charAt(0) || 'U'}</span>
                }
                <div className="prof-avatar-overlay">
                  {picUploading ? <span className="loading-spinner" /> : <Icon name="camera" size={22} />}
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePicChange}/>
              <span className="prof-avatar-hint">Change photo</span>
            </div>

            {/* Name & info */}
            <div className="prof-hero-info">
              <h1 className="prof-name">{userData?.full_name || 'Fitness Member'}</h1>
              <p className="prof-tagline">
                {userData?.fitness_goals?.length
                  ? `Focused on ${userData.fitness_goals.slice(0,2).join(' & ')}`
                  : 'A dedicated fitness enthusiast building strength and momentum.'}
              </p>
              <div className="prof-meta-row">
                <span className="prof-meta-chip"><Icon name="calendar" size={14} /> Joined {parseJoinedDate()}</span>
                {userData?.fitness_level && <span className="prof-meta-chip"><Icon name="activity" size={14} /> {userData.fitness_level}</span>}
                {userData?.age && <span className="prof-meta-chip"><Icon name="user" size={14} /> Age {userData.age}</span>}
              </div>
            </div>

            {/* Action buttons */}
            <div className="prof-hero-actions">
              <button className="prof-btn-primary" onClick={openEdit}><Icon name="edit" size={16} /> Edit profile</button>
            </div>
          </div>

          {/* Quick stats */}
          <div className="prof-quick-stats">
            <div className="prof-qs-item">
              <span className="prof-qs-val">{userData?.streak ?? 0}</span>
              <span className="prof-qs-lbl">Day streak</span>
            </div>
            <div className="prof-qs-divider"/>
            <div className="prof-qs-item">
              <span className="prof-qs-val">{userData?.points ?? 0}</span>
              <span className="prof-qs-lbl">Points</span>
            </div>
            <div className="prof-qs-divider"/>
            <div className="prof-qs-item">
              <span className="prof-qs-val">{userData?.workouts_completed ?? 0}</span>
              <span className="prof-qs-lbl">Workouts</span>
            </div>
            <div className="prof-qs-divider"/>
            <div className="prof-qs-item">
              <span className="prof-qs-val">{weeklyCalories ? `${weeklyCalories.toLocaleString()}` : '—'}</span>
              <span className="prof-qs-lbl">Weekly kcal</span>
            </div>
          </div>
        </div>

        {/* ── STATS GRID ── */}
        <div className="prof-grid">
          {/* Body */}
          <div className="prof-card card">
            <div className="prof-card-header">
              <span className="prof-card-icon"><Icon name="target" size={20} /></span>
              <div>
                <div className="prof-card-title">Body</div>
                <div className="prof-card-sub">Your current measurements</div>
              </div>
            </div>
            <div className="prof-stat-grid">
              {[
                { label: 'Height', val: userData?.height ? cmToFeetInches(userData.height) : '—', icon: 'activity' },
                { label: 'Current Weight', val: userData?.weight ? `${Math.round(userData.weight)} kg` : '—', icon: 'target' },
                { label: 'Target Weight', val: userData?.target_weight ? `${Math.round(userData.target_weight)} kg` : '—', icon: 'flag' },
                { label: 'Gender', val: userData?.gender || '—', icon: 'user' },
              ].map(item => (
                <div key={item.label} className="prof-stat-block">
                  <span className="prof-stat-icon"><Icon name={item.icon} size={17} /></span>
                  <strong className="prof-stat-val">{item.val}</strong>
                  <span className="prof-stat-lbl">{item.label}</span>
                </div>
              ))}
            </div>

            {/* Goal progress bar */}
            {userData?.weight && userData?.target_weight && (
              <div className="prof-goal-bar-wrap">
                <div className="prof-goal-bar-labels">
                  <span>Progress to target weight</span>
                  <span className="prof-goal-pct">{gp}%</span>
                </div>
                <div className="prof-goal-bar-track">
                  <div className="prof-goal-bar-fill" style={{width:`${gp}%`}}/>
                </div>
              </div>
            )}
          </div>

          {/* Health metrics */}
          <div className="prof-card card">
            <div className="prof-card-header">
              <span className="prof-card-icon"><Icon name="activity" size={20} /></span>
              <div>
                <div className="prof-card-title">Health metrics</div>
                <div className="prof-card-sub">Calculated from your profile</div>
              </div>
            </div>
            {showMetrics && healthMetrics ? (
              <div className="prof-metric-list">
                {[
                  { label: 'BMI', val: healthMetrics.bmi, color: 'var(--info)' },
                  { label: 'Body Fat', val: `${healthMetrics.bfp}%`, color: 'var(--heat)' },
                  { label: 'Category', val: healthMetrics.bmi_category, color: 'var(--go)' },
                  { label: 'BMR (per day)', val: healthMetrics.bmr ? `${Math.round(healthMetrics.bmr)} kcal` : '—', color: 'var(--heat)' },
                  { label: 'Weekly burn (est.)', val: weeklyCalories ? `${weeklyCalories.toLocaleString()} kcal` : '—', color: 'var(--brand)' },
                ].map(m => (
                  <div key={m.label} className="prof-metric-row">
                    <span className="prof-metric-lbl">{m.label}</span>
                    <span className="prof-metric-val" style={{color: m.color}}>{m.val}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="prof-hint-text">Show your BMI, body fat estimate and daily calorie needs.</p>
            )}
            <button className="prof-btn-secondary" onClick={() => setShowMetrics(p => !p)}>
              {showMetrics ? 'Hide metrics' : 'Show metrics'}
            </button>
          </div>

          {/* Training */}
          <div className="prof-card card">
            <div className="prof-card-header">
              <span className="prof-card-icon"><Icon name="flag" size={20} /></span>
              <div>
                <div className="prof-card-title">Training</div>
                <div className="prof-card-sub">Goals and preferences</div>
              </div>
            </div>
            <div className="prof-snapshot-list">
              <div className="prof-snapshot-item">
                <span>Goals</span>
                <strong>{userData?.fitness_goals?.join(', ') || 'Not set'}</strong>
              </div>
              <div className="prof-snapshot-item">
                <span>Level</span>
                <strong>{userData?.fitness_level || '—'}</strong>
              </div>
              <div className="prof-snapshot-item">
                <span>Units</span>
                <strong>{userData?.preferred_units === 'imperial' ? 'Imperial' : 'Metric'}</strong>
              </div>
              {userData?.medical_conditions && (
                <div className="prof-snapshot-item">
                  <span>Notes</span>
                  <strong>{userData.medical_conditions}</strong>
                </div>
              )}
            </div>
          </div>

          {/* Achievements */}
          <div className="prof-card card">
            <div className="prof-card-header">
              <span className="prof-card-icon"><Icon name="trophy" size={20} /></span>
              <div>
                <div className="prof-card-title">Achievements</div>
                <div className="prof-card-sub">Your totals so far</div>
              </div>
            </div>
            <div className="prof-perf-grid">
              {[
                { label: 'Workouts done', val: userData?.workouts_completed ?? 0, icon: 'activity', color: '#5cb6ff' },
                { label: 'Day streak', val: userData?.streak ?? 0, icon: 'flame', color: '#ff7a45' },
                { label: 'Total points', val: (userData?.points ?? 0).toLocaleString(), icon: 'zap', color: '#fbbf24' },
                { label: 'Weekly kcal', val: weeklyCalories ? weeklyCalories.toLocaleString() : '—', icon: 'flame', color: '#38d79f' },
              ].map(p => (
                <div key={p.label} className="prof-perf-card" style={{'--accent': p.color}}>
                  <span className="prof-perf-icon"><Icon name={p.icon} size={18} /></span>
                  <strong className="prof-perf-val" style={{color: p.color}}>{p.val}</strong>
                  <span className="prof-perf-lbl">{p.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Badges & achievements */}
          <div className="prof-card card prof-wide">
            <div className="prof-card-header">
              <span className="prof-card-icon"><Icon name="award" size={20} /></span>
              <div>
                <div className="prof-card-title">Badges</div>
                <div className="prof-card-sub">Earned by training, not by clicking</div>
              </div>
              {badges && badges.total > 0 && <span className="bd-count">{badges.earned_count}/{badges.total}</span>}
            </div>
            {badges === null ? <div className="sk" style={{ height: 96 }} /> : <BadgeGrid badges={badges.badges || []} />}
          </div>

          <WorkoutNames />

          <SavedPlans />

          {/* Appearance */}
          <div className="prof-card card prof-wide">
            <div className="prof-card-header">
              <span className="prof-card-icon"><Icon name="sun" size={20} /></span>
              <div>
                <div className="prof-card-title">Appearance</div>
                <div className="prof-card-sub">Choose a light or dark look for the app</div>
              </div>
            </div>
            <ThemeToggle variant="switch" />
          </div>
        </div>

        <div className="prof-account card">
          <div>
            <div className="prof-card-title">Delete account</div>
            <div className="prof-card-sub">Permanently remove your profile, workouts and posts.</div>
          </div>
          <button className="prof-btn-danger" onClick={() => setShowDeleteConfirm(true)}><Icon name="trash" size={16} /> Delete account</button>
        </div>
      </div>

      {/* ── EDIT MODAL ── */}
      {showEditModal && (
        <div className="prof-modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="prof-modal card" onClick={e => e.stopPropagation()}>
            <div className="prof-modal-header">
              <h2>Edit profile</h2>
              <button className="prof-modal-close" onClick={() => setShowEditModal(false)} aria-label="Close"><Icon name="x" size={18} /></button>
            </div>
            <div className="prof-modal-body">
              {[
                { label: 'Full name', key: 'full_name', type: 'text' },
                { label: 'Age', key: 'age', type: 'number' },
                { label: 'Weight (kg)', key: 'weight', type: 'number' },
              
                { label: 'Target weight (kg)', key: 'target_weight', type: 'number' },
              ].map(field => (
                <div key={field.key} className="prof-form-group">
                  <label>{field.label}</label>
                  <input
                    type={field.type}
                    value={editForm[field.key] || ''}
                    onChange={e => setEditForm(prev => ({...prev, [field.key]: e.target.value}))}
                    className="prof-form-input"
                  />
                </div>
              ))}
              <div className="prof-form-group">
                <label>Height</label>
                <select value={editForm.height || ''} onChange={e => setEditForm(p => ({...p, height: e.target.value}))} className="prof-form-input">
                  <option value="">Select height</option>
                  <option value="147.3">4'10"</option>
                  <option value="149.9">4'11"</option>
                  <option value="152.4">5'0"</option>
                  <option value="154.9">5'1"</option>
                  <option value="157.5">5'2"</option>
                  <option value="160">5'3"</option>
                  <option value="162.6">5'4"</option>
                  <option value="165.1">5'5"</option>
                  <option value="167.6">5'6"</option>
                  <option value="170.2">5'7"</option>
                  <option value="172.7">5'8"</option>
                  <option value="175.3">5'9"</option>
                  <option value="177.8">5'10"</option>
                  <option value="180.3">5'11"</option>
                  <option value="182.9">6'0"</option>
                  <option value="185.4">6'1"</option>
                  <option value="188">6'2"</option>
                  <option value="190.5">6'3"</option>
                  <option value="193">6'4"</option>
                  <option value="195.6">6'5"</option>
                  <option value="198.1">6'6"</option>
                </select>
              </div>
              <div className="prof-form-group">
                <label>Fitness level</label>
                <select value={editForm.fitness_level || ''} onChange={e => setEditForm(p => ({...p, fitness_level: e.target.value}))} className="prof-form-input">
                  <option value="">Select level</option>
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                </select>
              </div>
            </div>
            <div className="prof-modal-footer">
              <button className="prof-btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
              <button className="prof-btn-primary" onClick={handleEditSave} disabled={editLoading}>
                {editLoading ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM MODAL ── */}
      {showDeleteConfirm && (
        <div className="prof-modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="prof-modal card" onClick={e => e.stopPropagation()}>
            <div className="prof-modal-header">
              <h2>Delete account</h2>
              <button className="prof-modal-close" onClick={() => setShowDeleteConfirm(false)} aria-label="Close"><Icon name="x" size={18} /></button>
            </div>
            <div className="prof-modal-body">
              <div className="prof-delete-warning">
                <p><Icon name="alert" size={18} /> <span>This is <strong>permanent</strong>. Your data, workouts and progress will be deleted from our servers.</span></p>
              </div>
              <div className="prof-form-group">
                <label>Type <strong>DELETE</strong> to confirm:</label>
                <input
                  type="text"
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  placeholder="DELETE"
                  className="prof-form-input"
                />
              </div>
            </div>
            <div className="prof-modal-footer">
              <button className="prof-btn-secondary" onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}>Cancel</button>
              <button
                className="prof-btn-danger"
                onClick={handleDeleteAccount}
                disabled={deleteInput !== 'DELETE' || deleteLoading}
              >
                {deleteLoading ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
