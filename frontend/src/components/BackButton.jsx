import React from 'react';
import { useNavigate } from 'react-router-dom';
import './BackButton.css';

const BackButton = () => {
  const navigate = useNavigate();

  return (
    <div className="nav-buttons-floating">
      <button className="back-btn-floating" onClick={() => navigate(-1)} aria-label="Back">
        ← Back
      </button>
      <button className="return-home-btn-floating" onClick={() => navigate('/home')} aria-label="Return Home">
        🏠 Return Home
      </button>
    </div>
  );
};

export default BackButton;
