/* ============================================================
   Lesson diagrams — web port of src/features/lesson/LessonVisual.tsx
   ------------------------------------------------------------
   Same ids, same viewBox (240×140) and same geometry as the app,
   so a lesson looks like itself on either surface. Attach to a
   section with `visual: '<id>'` in the curriculum.

   Only the ten ids the curriculum actually uses are implemented;
   an unknown id renders nothing rather than an empty frame.
   ============================================================ */

// Mirrors colors.textMuted / colors.textSecondary from src/theme.
const AXIS = '#5B606E';
const LABEL = '#9CA2B0';

const axes = () => `
  <line x1="24" y1="12" x2="24" y2="116" stroke="${AXIS}" stroke-width="1.5" />
  <line x1="24" y1="116" x2="228" y2="116" stroke="${AXIS}" stroke-width="1.5" />`;

const label = (x, y, text, size = 11, anchor = 'middle') =>
  `<text x="${x}" y="${y}" fill="${LABEL}" font-size="${size}" font-weight="600"
         text-anchor="${anchor}" font-family="Plus Jakarta Sans, system-ui, sans-serif">${text}</text>`;

function body(id, c) {
  switch (id) {
    case 'yield-curve-normal':
      return axes()
        + `<path d="M24 100 C 90 92, 150 64, 220 36" stroke="${c}" stroke-width="3.5" fill="none" stroke-linecap="round" />`
        + `<circle cx="220" cy="36" r="5" fill="${c}" />`
        + label(126, 134, 'Maturity →');

    case 'yield-curve-inverted':
      return axes()
        + `<path d="M24 40 C 90 50, 150 80, 220 100" stroke="${c}" stroke-width="3.5" fill="none" stroke-linecap="round" />`
        + `<circle cx="220" cy="100" r="5" fill="${c}" />`
        + label(126, 134, 'Short yields &gt; long');

    case 'price-yield':
      return axes()
        + `<line x1="36" y1="32" x2="216" y2="104" stroke="${c}" stroke-width="3.5" stroke-linecap="round" />`
        + `<circle cx="36" cy="32" r="5" fill="${c}" />`
        + `<circle cx="216" cy="104" r="5" fill="${c}" />`
        + label(54, 26, 'Price ↑', 11, 'start')
        + label(150, 112, 'Yield ↑', 11, 'start');

    case 'call-payoff':
      return axes()
        + `<line x1="130" y1="12" x2="130" y2="116" stroke="${AXIS}" stroke-width="1" stroke-dasharray="4 4" />`
        + `<path d="M24 96 L 130 96 L 210 32" stroke="${c}" stroke-width="3.5" fill="none"
                 stroke-linecap="round" stroke-linejoin="round" />`
        + label(130, 134, 'Strike');

    case 'duration':
      return axes()
        + `<rect x="66" y="84" width="44" height="32" rx="4" fill="${c}" opacity="0.55" />`
        + `<rect x="150" y="36" width="44" height="80" rx="4" fill="${c}" />`
        + label(88, 132, '2Y')
        + label(172, 132, '10Y');

    case 'compound':
      return axes()
        + `<path d="M24 110 C 120 108, 180 80, 220 24" stroke="${c}" stroke-width="3.5" fill="none" stroke-linecap="round" />`
        + `<circle cx="220" cy="24" r="5" fill="${c}" />`
        + label(126, 134, 'Time →');

    case 'bid-ask':
      return `<line x1="24" y1="78" x2="228" y2="78" stroke="${AXIS}" stroke-width="1.5" />`
        + `<circle cx="92" cy="78" r="6" fill="${c}" />`
        + `<circle cx="164" cy="78" r="6" fill="${c}" />`
        + `<line x1="92" y1="52" x2="164" y2="52" stroke="${LABEL}" stroke-width="1.5" />`
        + `<line x1="92" y1="52" x2="92" y2="72" stroke="${LABEL}" stroke-width="1.5" />`
        + `<line x1="164" y1="52" x2="164" y2="72" stroke="${LABEL}" stroke-width="1.5" />`
        + label(128, 44, 'Spread')
        + label(92, 100, 'Bid')
        + label(164, 100, 'Ask');

    case 'market-cap':
      return axes()
        + `<rect x="50" y="86" width="34" height="30" rx="4" fill="${c}" opacity="0.4" />`
        + `<rect x="104" y="62" width="34" height="54" rx="4" fill="${c}" opacity="0.7" />`
        + `<rect x="158" y="34" width="34" height="82" rx="4" fill="${c}" />`
        + label(67, 132, 'Small', 10)
        + label(121, 132, 'Mid', 10)
        + label(175, 132, 'Large', 10);

    case 'three-statements':
      return `<rect x="12" y="48" width="60" height="44" rx="8" fill="none" stroke="${c}" stroke-width="2" />`
        + `<rect x="90" y="48" width="60" height="44" rx="8" fill="none" stroke="${c}" stroke-width="2" />`
        + `<rect x="168" y="48" width="60" height="44" rx="8" fill="none" stroke="${c}" stroke-width="2" />`
        + `<line x1="72" y1="70" x2="90" y2="70" stroke="${LABEL}" stroke-width="2" />`
        + `<line x1="150" y1="70" x2="168" y2="70" stroke="${LABEL}" stroke-width="2" />`
        + label(42, 73, 'Income', 9)
        + label(120, 73, 'Cash flow', 9)
        + label(198, 73, 'Balance', 9);

    case 'supply-demand':
      return axes()
        + `<line x1="32" y1="100" x2="210" y2="32" stroke="${c}" stroke-width="3" stroke-linecap="round" />`
        + `<line x1="32" y1="32" x2="210" y2="100" stroke="${LABEL}" stroke-width="3" stroke-linecap="round" />`
        + `<circle cx="121" cy="66" r="5" fill="${c}" />`;

    default:
      return null;
  }
}

/** Returns the full <svg> for a diagram id, or '' when there isn't one. */
export function diagram(id, color) {
  const inner = body(id, color || '#8234FA');
  if (!inner) return '';
  return `<div class="ba-visual"><svg viewBox="0 0 240 140" role="img"
    aria-label="Diagram illustrating this concept">${inner}</svg></div>`;
}
