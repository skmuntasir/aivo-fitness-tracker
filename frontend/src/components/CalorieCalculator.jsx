import React, { useState } from "react";
import API from "../services/api";
import "./CalorieCalculator.css";

function CalorieCalculator({ token, profile = {} }) {
  const [inputs, setInputs] = useState({
    age: profile.age || "",
    weight: profile.weight || "",
    height: profile.height || "",
    gender: profile.gender || "",
    activityLevel: "moderate",
    goal: "maintain"
  });
  const [calories, setCalories] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = e => {
    setInputs({ ...inputs, [e.target.name]: e.target.value });
    setCalories(null);
    setError("");
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setError(""); setCalories(null); setLoading(true);
    try {
      const response = await API.post("/calculate-calories", inputs);
      const data = response.data;
      if (data.success) setCalories(data.calories);
      else setError(data.message || "Calculation failed.");
    } catch {
      setError("Could not connect to API.");
    } finally { setLoading(false); }
  };

  const goalLabels = {
    lose: { icon: '📉', label: 'Lose Weight', color: '#34d399' },
    maintain: { icon: '⚖️', label: 'Maintain Weight', color: '#818cf8' },
    gain: { icon: '📈', label: 'Gain Weight', color: '#f472b6' },
  };

  return (
    <div className="calc-wrap">
      <div className="calc-header">
        <span className="calc-icon">🔥</span>
        <div>
          <div className="calc-title">Calorie Calculator</div>
          <div className="calc-sub">Calculate your daily intake target</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="calc-form">
        <div className="calc-row">
          <div className="calc-field">
            <label>Age</label>
            <input type="number" name="age" value={inputs.age} onChange={handleChange} required placeholder="25" className="calc-input"/>
          </div>
          <div className="calc-field">
            <label>Weight (kg)</label>
            <input type="number" name="weight" value={inputs.weight} onChange={handleChange} required placeholder="70" className="calc-input"/>
          </div>
          <div className="calc-field">
            <label>Height (cm)</label>
            <input type="number" name="height" value={inputs.height} onChange={handleChange} required placeholder="175" className="calc-input"/>
          </div>
        </div>

        <div className="calc-field">
          <label>Gender</label>
          <select name="gender" value={inputs.gender} onChange={handleChange} required className="calc-select">
            <option value="">Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>

        <div className="calc-field">
          <label>Activity Level</label>
          <select name="activityLevel" value={inputs.activityLevel} onChange={handleChange} className="calc-select">
            <option value="sedentary">Sedentary (little/no exercise)</option>
            <option value="light">Lightly Active (1–3 days/week)</option>
            <option value="moderate">Moderately Active (3–5 days/week)</option>
            <option value="active">Active (6–7 days/week)</option>
            <option value="very active">Very Active (hard daily exercise)</option>
          </select>
        </div>

        <div className="calc-field">
          <label>Goal</label>
          <div className="calc-goal-row">
            {['lose','maintain','gain'].map(g => (
              <button
                key={g}
                type="button"
                className={`calc-goal-btn ${inputs.goal === g ? 'active' : ''}`}
                style={{'--accent': goalLabels[g].color}}
                onClick={() => { setInputs(p => ({...p, goal: g})); setCalories(null); }}
              >
                <span>{goalLabels[g].icon}</span>
                <span>{goalLabels[g].label}</span>
              </button>
            ))}
          </div>
        </div>

        <button type="submit" className="calc-submit" disabled={loading}>
          {loading ? "Calculating…" : "🔥 Calculate My Calories"}
        </button>
      </form>

      {calories !== null && (
        <div className="calc-result">
          <div className="calc-result-label">Recommended Daily Intake</div>
          <div className="calc-result-value">{calories.toLocaleString()}</div>
          <div className="calc-result-unit">calories / day</div>
          <p className="calc-result-hint">
            {inputs.goal === 'lose' ? '500 kcal deficit applied for steady fat loss.' :
             inputs.goal === 'gain' ? '500 kcal surplus applied for muscle building.' :
             'Maintenance calories calculated for your activity level.'}
          </p>
        </div>
      )}

      {error && <div className="calc-error">⚠️ {error}</div>}
    </div>
  );
}

export default CalorieCalculator;
