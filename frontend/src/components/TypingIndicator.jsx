import React from 'react';
import './UiKit.css';

// Animated "…" bubble. `inline` = tiny dots for list previews; default = full chat bubble.
const TypingIndicator = ({ name, inline = false }) => (
  inline ? (
    <span className="ui-typing-inline" aria-label="typing">typing<span className="ui-dots"><i /><i /><i /></span></span>
  ) : (
    <div className="ui-typing" role="status" aria-live="polite">
      <span className="ui-dots"><i /><i /><i /></span>
      <span className="ui-typing-label">{name ? `${name.split(' ')[0]} is typing` : 'typing'}</span>
    </div>
  )
);

export default TypingIndicator;
