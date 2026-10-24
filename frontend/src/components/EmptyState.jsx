import React from 'react';
import Icon from './Icon';
import './UiKit.css';

// Friendly placeholder for lists with nothing in them yet.
const EmptyState = ({ icon = 'users', title, text, action, compact = false }) => (
  <div className={`ui-empty ${compact ? 'compact' : ''}`}>
    <span className="ui-empty-icon"><Icon name={icon} size={compact ? 22 : 28} /></span>
    {title && <strong>{title}</strong>}
    {text && <p>{text}</p>}
    {action}
  </div>
);

export default EmptyState;
