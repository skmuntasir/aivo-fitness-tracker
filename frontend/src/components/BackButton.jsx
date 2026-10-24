import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import './BackButton.css';

const BackButton = () => {
  const navigate = useNavigate();

  return (
    <div className="nav-buttons-floating">
      <button className="back-btn-floating" onClick={() => navigate(-1)} aria-label="Back">
        <Icon name="arrowLeft" size={15} /> Back
      </button>
      <button className="return-home-btn-floating" onClick={() => navigate('/home')} aria-label="Return Home">
        <Icon name="home" size={15} /> Return Home
      </button>
    </div>
  );
};

export default BackButton;
