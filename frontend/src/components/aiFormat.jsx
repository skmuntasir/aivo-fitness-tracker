import React from 'react';
import Markdown from './Markdown';
import './AiCoach.css';

// Kept as a function so existing callers keep working: renders the coach's reply as clean, structured text.
export const formatAIMessage = (text) => (text ? <Markdown text={text} /> : null);

export default formatAIMessage;
