/** Minimal stroked line icons (currentColor / stroke via CSS). */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const IconTarget = () => (
  <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></svg>
);
export const IconAI = () => (
  <svg viewBox="0 0 24 24" {...P}><circle cx="7" cy="8" r="2" /><circle cx="17" cy="7" r="2" /><circle cx="12" cy="16" r="2" /><path d="M8.7 9.2 10.6 14.5M15.4 8.4 13 14.6M9 8h6" /></svg>
);
export const IconChart = () => (
  <svg viewBox="0 0 24 24" {...P}><path d="M4 20V5M4 20h16" /><path d="M8 20v-6M13 20v-9M18 20v-4" /></svg>
);
export const IconShield = () => (
  <svg viewBox="0 0 24 24" {...P}><path d="M12 3 5 6v5c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z" /><path d="M9.5 12l1.8 1.8 3.2-3.6" /></svg>
);
export const IconFlorida = () => (
  <svg viewBox="0 0 24 24" {...P}><path d="M4 5h9v4c0 3 1.5 4 3 6l1.5 3.5-2 1L13 17c-1.5-1.5-3-2-4.5-2H7" /></svg>
);
export const IconPin = () => (
  <svg viewBox="0 0 24 24" {...P}><path d="M12 21c4-4.5 6-7.5 6-11a6 6 0 1 0-12 0c0 3.5 2 6.5 6 11Z" /><circle cx="12" cy="10" r="2.2" /></svg>
);
export const IconTag = () => (
  <svg viewBox="0 0 24 24" {...P}><path d="M7 4h6l7 7-9 9-4-4" /><circle cx="9.5" cy="8.5" r="1.3" /></svg>
);
export const IconBars = () => (
  <svg viewBox="0 0 24 24" {...P}><path d="M4 20V4" /><path d="M8 20v-7M13 20v-11M18 20v-5" /></svg>
);
export const IconArrow = () => (
  <svg viewBox="0 0 24 24" {...P}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
