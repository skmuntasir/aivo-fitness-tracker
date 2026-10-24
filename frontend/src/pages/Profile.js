import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './Profile.css';
import API from '../services/api';
import BackButton from '../components/BackButton';
import { useFeedback } from '../components/Feedback';


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
  const [userData, setUserData] = useState(null);
  const [healthMetrics, setHealthMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const fileInputRef = useRef(null);

  useEffect(() => { fetchUserData(); }, []);

  const fetchUserData = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setError('Authentication token missing. Please log in again.'); setLoading(false); return; }
    try {
      setLoading(true); setError(null);
      const profileResponse = await API.get('/auth/profile');
      if (!profileResponse.data.success) { setError(profileResponse.data.message || 'Failed to load profile.'); setLoading(false); return; }
      const user = profileResponse.data.user;
      setUserData(user);
      const uid = user._id || user.id || getUserId();
      const picKey = uid ? `profilePic_${uid}` : 'profilePic';
      const pic = user.profile_picture || localStorage.getItem(picKey) || null;
      setProfilePic(pic);
      if (user.profile_picture) localStorage.setItem(picKey, user.profile_picture);
      try {
        const metricsResponse = await API.get('/auth/calculate-health-metrics');
        if (metricsResponse.data.success) setHealthMetrics(metricsResponse.data.metrics);
      } catch { setHealthMetrics(null); }
    } catch (err) {
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/login'; return;
      }
      setError(err.response?.data?.message || 'Failed to load user data.');
    } finally { setLoading(false); }
  };

  const parseJoinedDate = () => {
    const rawDate = userData?.created_at || userData?.joined_at;
    if (!rawDate) return 'Joined recently';
    const date = new Date(rawDate);
    return isNaN(date.getTime()) ? 'Joined recently' : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
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
      <div className="profile-loading"><div className="loading-spinner"/><p>Loading your profile...</p></div>
    </div>
  );

  if (error) return (
    <div className="profile-page">
      <div className="home-bg-gradient"></div>
      <div className="home-bg-orbs"><div className="orb orb-1"></div><div className="orb orb-2"></div><div className="orb orb-3"></div></div>
      <BackButton />
      <div className="profile-error glass-panel">
        <h2>⚠️ Error</h2><p>{error}</p>
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
      {/* Background matching Home page */}
      <div className="home-bg-gradient"></div>
      <div className="home-bg-orbs">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>

      <BackButton />

      <div className="profile-content">
        {/* ── HERO CARD ── */}
        <div className="prof-hero glass-panel">
          <div className="prof-hero-inner">
            {/* Avatar with upload */}
            <div className="prof-avatar-wrap">
              <div className="prof-avatar" onClick={() => fileInputRef.current?.click()}>
                {profilePic
                  ? <img src={profilePic} alt="Profile" className="prof-avatar-img"/>
                  : <span className="prof-avatar-initial">{userData?.full_name?.charAt(0) || 'U'}</span>
                }
                <div className="prof-avatar-overlay">
                  {picUploading ? '⏳' : '📷'}
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePicChange}/>
              <span className="prof-avatar-hint">Click to change photo</span>
            </div>

            {/* Name & info */}
            <div className="prof-hero-info">
              <span className="pg-eyebrow">PROFILE DASHBOARD</span>
              <h1 className="prof-name">{userData?.full_name || 'Fitness Member'}</h1>
              <p className="prof-tagline">
                {userData?.fitness_goals?.length
                  ? `Focused on ${userData.fitness_goals.slice(0,2).join(' & ')}`
                  : 'A dedicated fitness enthusiast building strength and momentum.'}
              </p>
              <div className="prof-meta-row">
                <span className="prof-meta-chip">🗓 {parseJoinedDate()}</span>
                {userData?.fitness_level && <span className="prof-meta-chip">🏋️ {userData.fitness_level}</span>}
                {userData?.age && <span className="prof-meta-chip">🎂 Age {userData.age}</span>}
              </div>
            </div>

            {/* Action buttons */}
            <div className="prof-hero-actions">
              <button className="prof-btn-primary" onClick={openEdit}>✏️ Edit Profile</button>
              <button className="prof-btn-danger" onClick={() => setShowDeleteConfirm(true)}>🗑 Delete Account</button>
            </div>
          </div>

          {/* Quick stats */}
          <div className="prof-quick-stats">
            <div className="prof-qs-item">
              <span className="prof-qs-val">{userData?.streak ?? 0}</span>
              <span className="prof-qs-lbl">🔥 Day Streak</span>
            </div>
            <div className="prof-qs-divider"/>
            <div className="prof-qs-item">
              <span className="prof-qs-val">{userData?.points ?? 0}</span>
              <span className="prof-qs-lbl">⚡ Points</span>
            </div>
            <div className="prof-qs-divider"/>
            <div className="prof-qs-item">
              <span className="prof-qs-val">{userData?.workouts_completed ?? 0}</span>
              <span className="prof-qs-lbl">💪 Workouts</span>
            </div>
            <div className="prof-qs-divider"/>
            <div className="prof-qs-item">
              <span className="prof-qs-val">{weeklyCalories ? `${weeklyCalories.toLocaleString()}` : '—'}</span>
              <span className="prof-qs-lbl">🔥 Weekly kcal</span>
            </div>
          </div>
        </div>

        {/* ── STATS GRID ── */}
        <div className="prof-grid">
          {/* Body Stats */}
          <div className="prof-card glass-panel">
            <div className="prof-card-header">
              <span className="prof-card-icon">⚖️</span>
              <div>
                <div className="prof-card-title">Body Stats</div>
                <div className="prof-card-sub">Your current measurements</div>
              </div>
            </div>
            <div className="prof-stat-grid">
              {[
                { label: 'Height', val: userData?.height ? cmToFeetInches(userData.height) : '—', icon: '📏' },
                { label: 'Current Weight', val: userData?.weight ? `${Math.round(userData.weight)} kg` : '—', icon: '⚖️' },
                { label: 'Target Weight', val: userData?.target_weight ? `${Math.round(userData.target_weight)} kg` : '—', icon: '🎯' },
                { label: 'Gender', val: userData?.gender || '—', icon: '👤' },
              ].map(item => (
                <div key={item.label} className="prof-stat-block">
                  <span className="prof-stat-icon">{item.icon}</span>
                  <strong className="prof-stat-val">{item.val}</strong>
                  <span className="prof-stat-lbl">{item.label}</span>
                </div>
              ))}
            </div>

            {/* Goal progress bar */}
            {userData?.weight && userData?.target_weight && (
              <div className="prof-goal-bar-wrap">
                <div className="prof-goal-bar-labels">
                  <span>Goal Progress</span>
                  <span style={{color:'#818cf8'}}>{gp}%</span>
                </div>
                <div className="prof-goal-bar-track">
                  <div className="prof-goal-bar-fill" style={{width:`${gp}%`}}/>
                </div>
              </div>
            )}
          </div>

          {/* Health Metrics */}
          <div className="prof-card glass-panel">
            <div className="prof-card-header">
              <span className="prof-card-icon">🧠</span>
              <div>
                <div className="prof-card-title">Health Metrics</div>
                <div className="prof-card-sub">AI-calculated from your profile</div>
              </div>
            </div>
            {showMetrics && healthMetrics ? (
              <div className="prof-metric-list">
                {[
                  { label: 'BMI', val: healthMetrics.bmi, color: '#818cf8' },
                  { label: 'Body Fat', val: `${healthMetrics.bfp}%`, color: '#f472b6' },
                  { label: 'Category', val: healthMetrics.bmi_category, color: '#34d399' },
                  { label: 'BMR (daily)', val: healthMetrics.bmr ? `${Math.round(healthMetrics.bmr)} kcal` : '—', color: '#fb923c' },
                  { label: 'Weekly Burn Est.', val: weeklyCalories ? `${weeklyCalories.toLocaleString()} kcal` : '—', color: '#fbbf24' },
                ].map(m => (
                  <div key={m.label} className="prof-metric-row">
                    <span className="prof-metric-lbl">{m.label}</span>
                    <span className="prof-metric-val" style={{color: m.color}}>{m.val}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="prof-hint-text">Toggle to reveal your BMI, body fat percentage, and calorie estimates.</p>
            )}
            <button className="prof-btn-secondary" onClick={() => setShowMetrics(p => !p)}>
              {showMetrics ? '🙈 Hide Metrics' : '📊 Show Metrics'}
            </button>
          </div>

          {/* Fitness Snapshot */}
          <div className="prof-card glass-panel">
            <div className="prof-card-header">
              <span className="prof-card-icon">🏃</span>
              <div>
                <div className="prof-card-title">Fitness Snapshot</div>
                <div className="prof-card-sub">Goals & preferences</div>
              </div>
            </div>
            <div className="prof-snapshot-list">
              <div className="prof-snapshot-item">
                <span>Main Goals</span>
                <strong>{userData?.fitness_goals?.join(', ') || 'Not set'}</strong>
              </div>
              <div className="prof-snapshot-item">
                <span>Fitness Level</span>
                <strong>{userData?.fitness_level || '—'}</strong>
              </div>
              <div className="prof-snapshot-item">
                <span>Preferred Units</span>
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

          {/* Performance */}
          <div className="prof-card glass-panel">
            <div className="prof-card-header">
              <span className="prof-card-icon">🏆</span>
              <div>
                <div className="prof-card-title">Performance</div>
                <div className="prof-card-sub">Your fitness achievements</div>
              </div>
            </div>
            <div className="prof-perf-grid">
              {[
                { label: 'Workouts Done', val: userData?.workouts_completed ?? 0, icon: '💪', color: '#818cf8' },
                { label: 'Day Streak', val: userData?.streak ?? 0, icon: '🔥', color: '#f472b6' },
                { label: 'Total Points', val: (userData?.points ?? 0).toLocaleString(), icon: '⚡', color: '#fbbf24' },
                { label: 'Weekly kcal', val: weeklyCalories ? weeklyCalories.toLocaleString() : '—', icon: '🔥', color: '#34d399' },
              ].map(p => (
                <div key={p.label} className="prof-perf-card" style={{'--accent': p.color}}>
                  <span className="prof-perf-icon">{p.icon}</span>
                  <strong className="prof-perf-val" style={{color: p.color}}>{p.val}</strong>
                  <span className="prof-perf-lbl">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── EDIT MODAL ── */}
      {showEditModal && (
        <div className="prof-modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="prof-modal glass-panel" onClick={e => e.stopPropagation()}>
            <div className="prof-modal-header">
              <h2>✏️ Edit Profile</h2>
              <button className="prof-modal-close" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            <div className="prof-modal-body">
              {[
                { label: 'Full Name', key: 'full_name', type: 'text' },
                { label: 'Age', key: 'age', type: 'number' },
                { label: 'Weight (kg)', key: 'weight', type: 'number' },
              
                { label: 'Target Weight (kg)', key: 'target_weight', type: 'number' },
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
                <label>Fitness Level</label>
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
                {editLoading ? 'Saving…' : '💾 Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM MODAL ── */}
      {showDeleteConfirm && (
        <div className="prof-modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="prof-modal glass-panel" onClick={e => e.stopPropagation()}>
            <div className="prof-modal-header">
              <h2>🗑 Delete Account</h2>
              <button className="prof-modal-close" onClick={() => setShowDeleteConfirm(false)}>✕</button>
            </div>
            <div className="prof-modal-body">
              <div className="prof-delete-warning">
                <p>⚠️ This action is <strong>permanent and irreversible</strong>. All your data, workouts, and progress will be deleted from our servers.</p>
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
                {deleteLoading ? 'Deleting…' : '🗑 Delete My Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
