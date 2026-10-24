import React, { useState, useRef } from 'react';
import './Register.css';
import API from '../services/api';
import { useFeedback } from '../components/Feedback';

// Compress and convert image file to base64 (max 400px, quality 0.7)
const compressImage = (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 400;
        let w = img.width, h = img.height;
        if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
        else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};

const Register = () => {
  const { toast } = useFeedback();
  const picInputRef = useRef(null);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    age: '',
    gender: '',
    weight: '',
    height: '',
    fitnessLevel: '',
    fitnessGoals: [],
    medicalConditions: '',
    preferredUnits: 'metric',
    targetWeight: '',
    profilePicture: null
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const fitnessLevels = ['Beginner', 'Intermediate', 'Advanced'];
  const fitnessGoalOptions = [
    'Fat Loss', 'Strength', 'Endurance', 'Flexibility', 
    'Push-ups', 'Muscle Building', 'Weight Loss', 'General Fitness'
  ];

  const handleChange = (e) => {
    const { name, value, type, files } = e.target;
    
    if (type === 'file') {
      const file = files[0];
      if (file) {
        compressImage(file).then(base64 => {
          setFormData(prev => ({ ...prev, [name]: base64, profilePicturePreview: base64 }));
        });
      }
    } else if (type === 'checkbox') {
      const checked = e.target.checked;
      const goal = value;
      setFormData(prev => ({
        ...prev,
        fitnessGoals: checked 
          ? [...prev.fitnessGoals, goal]
          : prev.fitnessGoals.filter(g => g !== goal)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    // Required fields
    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
      newErrors.password = 'Password must contain uppercase, lowercase, and number';
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (!formData.age) {
      newErrors.age = 'Age is required';
    } else if (formData.age < 13 || formData.age > 120) {
      newErrors.age = 'Please enter a valid age (13-120)';
    }

    if (!formData.gender) {
      newErrors.gender = 'Please select your gender';
    }

    if (!formData.weight) {
      newErrors.weight = 'Weight is required';
    }

    if (!formData.height) {
      newErrors.height = 'Height is required';
    }

    if (!formData.fitnessLevel) {
      newErrors.fitnessLevel = 'Please select your fitness level';
    }

    if (formData.fitnessGoals.length === 0) {
      newErrors.fitnessGoals = 'Please select at least one fitness goal';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    let redirecting = false;

    try {
      // Prepare data for API call
      const submitData = {
        fullName: formData.fullName,
        email: formData.email,
        password: formData.password,
        age: parseInt(formData.age),
        gender: formData.gender,
        weight: Math.round(parseFloat(formData.weight)),
        height: Math.round(parseFloat(formData.height) * 10) / 10,
        fitnessLevel: formData.fitnessLevel,
        fitnessGoals: formData.fitnessGoals,
        medicalConditions: formData.medicalConditions,
        preferredUnits: formData.preferredUnits,
        targetWeight: formData.targetWeight ? Math.round(parseFloat(formData.targetWeight)) : null,
        profilePicture: formData.profilePicture || null
      };

      // Make API call to register
      const response = await API.post('/auth/register', submitData);
      
      if (response.data.success) {
        // Store token and user data
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        
        // Show success message
        toast('Registration successful! Welcome to Aivo!', 'success');
        
        // Redirect to home page (short delay so the message is seen)
        setTimeout(() => { window.location.href = '/home'; }, 1300);
        redirecting = true; // keep the form busy until the redirect
      } else {
        // Handle API errors
        if (response.data.errors) {
          setErrors(response.data.errors);
        } else {
          toast(response.data.message || 'Registration failed. Please try again.', 'error');
        }
      }

    } catch (error) {
      console.error('Registration error:', error);
      
      if (error.response && error.response.data) {
        if (error.response.data.errors) {
          setErrors(error.response.data.errors);
        } else {
          toast(error.response.data.message || 'Registration failed. Please try again.', 'error');
        }
      } else {
        toast('Network error. Please check your connection and try again.', 'error');
      }
    } finally {
      if (!redirecting) setIsLoading(false);
    }
  };

  return (
    <div className="register-container">
      <div className="register-card">
        <div className="register-header">
          <div className="logo">
            <div className="logo-icon">💪</div>
            <h1>Join Aivo</h1>
          </div>
          <p className="welcome-text">Start your fitness journey today!</p>
        </div>

        <form onSubmit={handleSubmit} className="register-form">
          {/* Personal Information */}
          <div className="form-section">
            <h3>Personal Information</h3>
            
            <div className="form-group">
              <label htmlFor="fullName">Full Name *</label>
              <input
                type="text"
                id="fullName"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="Enter your full name"
                className={`form-input ${errors.fullName ? 'error' : ''}`}
              />
              {errors.fullName && <span className="error-message">{errors.fullName}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="email">Email Address *</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Enter your email"
                className={`form-input ${errors.email ? 'error' : ''}`}
              />
              {errors.email && <span className="error-message">{errors.email}</span>}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="password">Password *</label>
                <div className="input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Enter your password"
                    className={`form-input ${errors.password ? 'error' : ''}`}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? "🙈" : "👁️"}
                  </button>
                </div>
                {errors.password && <span className="error-message">{errors.password}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password *</label>
                <div className="input-wrapper">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="Confirm your password"
                    className={`form-input ${errors.confirmPassword ? 'error' : ''}`}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? "🙈" : "👁️"}
                  </button>
                </div>
                {errors.confirmPassword && <span className="error-message">{errors.confirmPassword}</span>}
              </div>
            </div>
          </div>

          {/* Physical Information */}
          <div className="form-section">
            <h3>Physical Information</h3>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="age">Age *</label>
                <input
                  type="number"
                  id="age"
                  name="age"
                  value={formData.age}
                  onChange={handleChange}
                  placeholder="Enter your age"
                  min="13"
                  max="120"
                  className={`form-input ${errors.age ? 'error' : ''}`}
                />
                {errors.age && <span className="error-message">{errors.age}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="gender">Gender *</label>
                <select
                  id="gender"
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  className={`form-input ${errors.gender ? 'error' : ''}`}
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer-not-to-say">Prefer not to say</option>
                </select>
                {errors.gender && <span className="error-message">{errors.gender}</span>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="weight">Weight *</label>
                <div className="input-with-unit">
                  <input
                    type="number"
                    id="weight"
                    name="weight"
                    value={formData.weight}
                    onChange={handleChange}
                    placeholder="Enter weight"
                    step="0.1"
                    className={`form-input ${errors.weight ? 'error' : ''}`}
                  />
                  <span className="unit-label">{formData.preferredUnits === 'metric' ? 'kg' : 'lbs'}</span>
                </div>
                {errors.weight && <span className="error-message">{errors.weight}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="height">Height *</label>
                <select
                  id="height"
                  name="height"
                  value={formData.height}
                  onChange={handleChange}
                  className={`form-input ${errors.height ? 'error' : ''}`}
                >
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
                {errors.height && <span className="error-message">{errors.height}</span>}
              </div>
            </div>
          </div>

          {/* Fitness Information */}
          <div className="form-section">
            <h3>Fitness Information</h3>
            
            <div className="form-group">
              <label htmlFor="fitnessLevel">Fitness Level *</label>
              <select
                id="fitnessLevel"
                name="fitnessLevel"
                value={formData.fitnessLevel}
                onChange={handleChange}
                className={`form-input ${errors.fitnessLevel ? 'error' : ''}`}
              >
                <option value="">Select fitness level</option>
                {fitnessLevels.map(level => (
                  <option key={level} value={level.toLowerCase()}>{level}</option>
                ))}
              </select>
              {errors.fitnessLevel && <span className="error-message">{errors.fitnessLevel}</span>}
            </div>

            <div className="form-group">
              <label>Fitness Goals *</label>
              <div className="checkbox-grid">
                {fitnessGoalOptions.map(goal => (
                  <label key={goal} className="checkbox-wrapper">
                    <input
                      type="checkbox"
                      name="fitnessGoals"
                      value={goal}
                      checked={formData.fitnessGoals.includes(goal)}
                      onChange={handleChange}
                    />
                    <span className="checkmark"></span>
                    {goal}
                  </label>
                ))}
              </div>
              {errors.fitnessGoals && <span className="error-message">{errors.fitnessGoals}</span>}
            </div>
          </div>

          {/* Additional Information */}
          <div className="form-section">
            <h3>Additional Information</h3>
            
            <div className="form-group">
              <label htmlFor="medicalConditions">Medical Conditions or Injuries (Optional)</label>
              <textarea
                id="medicalConditions"
                name="medicalConditions"
                value={formData.medicalConditions}
                onChange={handleChange}
                placeholder="Please mention any medical conditions, injuries, or health concerns..."
                rows="4"
                className="form-textarea"
              />
            </div>


            <div className="form-group">
              <label htmlFor="targetWeight">Target Weight (Optional)</label>
              <div className="input-with-unit">
                <input
                  type="number"
                  id="targetWeight"
                  name="targetWeight"
                  value={formData.targetWeight}
                  onChange={handleChange}
                  placeholder="Enter target weight"
                  step="0.1"
                  className="form-input"
                />
                <span className="unit-label">{formData.preferredUnits === 'metric' ? 'kg' : 'lbs'}</span>
              </div>
            </div>

            <div className="form-group reg-pic-group">
              <label>Profile Picture <span className="optional-label">(Optional)</span></label>
              <div className="reg-avatar-uploader" onClick={() => picInputRef.current?.click()}>
                {formData.profilePicturePreview
                  ? <img src={formData.profilePicturePreview} alt="Preview" className="reg-avatar-img" />
                  : <div className="reg-avatar-placeholder">
                      <span className="reg-avatar-icon">📷</span>
                      <span className="reg-avatar-text">Click to upload photo</span>
                    </div>
                }
                <div className="reg-avatar-overlay">📷 Change</div>
              </div>
              <input
                ref={picInputRef}
                type="file"
                id="profilePicture"
                name="profilePicture"
                accept="image/*"
                onChange={handleChange}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          <button
            type="submit"
            className={`register-button ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="loading-spinner">⏳</span>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="register-footer">
          <p>Already have an account? <a href="/login" className="login-link">Sign in</a></p>
        </div>
      </div>
    </div>
  );
};

export default Register; 