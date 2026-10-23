import React from 'react';
import './UiKit.css';

// Initial-letter avatar with an optional live presence dot (green = online).
const Avatar = ({ name = '', online, size = 44, className = '', showPresence = true }) => (
  <div className={`ui-avatar ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
    {name?.charAt(0)?.toUpperCase() || '?'}
    {showPresence && online !== undefined && (
      <span className={`ui-presence ${online ? 'online' : 'offline'}`}
        style={{ width: Math.max(10, Math.round(size * 0.28)), height: Math.max(10, Math.round(size * 0.28)) }}
        title={online ? 'Online' : 'Offline'} />
    )}
  </div>
);

export default Avatar;
