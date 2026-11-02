import React from 'react';
import Icon from './Icon';
import './Engage.css';

// One round medal. `tier` only picks the colour; locked badges are greyed with a lock.
export function BadgeMedal({ badge, size = 46 }) {
  const earned = badge.earned !== false;
  return (
    <span className={`bd-medal bd-${badge.tier}${earned ? '' : ' locked'}`} style={{ width: size, height: size }}>
      <Icon name={earned ? badge.icon : 'lock'} size={Math.round(size * 0.45)} />
    </span>
  );
}

// Full grid for the Profile page: earned badges first, locked ones show how far along you are.
export function BadgeGrid({ badges }) {
  const sorted = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned));
  return (
    <div className="bd-grid">
      {sorted.map((b) => (
        <div key={b.id} className={`bd-card${b.earned ? ' earned' : ''}`} title={b.desc}>
          <BadgeMedal badge={b} />
          <strong className="bd-name">{b.name}</strong>
          <span className="bd-desc">{b.desc}</span>
          {!b.earned && (
            <span className="bd-progress" aria-label={`${b.progress} of ${b.target}`}>
              <span className="bd-bar"><i style={{ width: `${Math.round((b.progress / b.target) * 100)}%` }} /></span>
              <small>{b.progress}/{b.target}</small>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// Compact row of earned badges (leaderboard player sheet, workout result).
export function BadgeStrip({ badges, max = 8 }) {
  const shown = badges.slice(0, max);
  const extra = badges.length - shown.length;
  return (
    <div className="bd-strip">
      {shown.map((b) => (
        <span key={b.id} className="bd-chip" title={b.desc}>
          <BadgeMedal badge={{ ...b, earned: true }} size={26} />
          <span>{b.name}</span>
        </span>
      ))}
      {extra > 0 && <span className="bd-more">+{extra} more</span>}
    </div>
  );
}
