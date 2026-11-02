import React from 'react';
import logoDark from '../pages/images/aivo_logo.webp';
import logoLight from '../pages/images/aivo_logo_light.webp';

// Aivo logo. The original has white lettering (made for dark backgrounds), so light theme gets a
// recoloured copy (white parts turned deep indigo, gold untouched). The swap is pure CSS (styles/light.css).
export default function Logo({ className = '', alt = '', priority = false, ...rest }) {
  const common = { width: 360, height: 240, decoding: 'async', ...rest };
  return (
    <>
      <img src={logoDark} alt={alt} className={`${className} logo-dark`.trim()} fetchPriority={priority ? 'high' : undefined} {...common} />
      <img src={logoLight} alt={alt} aria-hidden="true" className={`${className} logo-light`.trim()} {...common} />
    </>
  );
}
