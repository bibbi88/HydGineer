/** The toolbar's icon set: the conventional glyph for each action - a floppy disk for save, an
 * open folder for load, a tray-and-arrow for export, transport controls for the simulation,
 * curved arrows for undo/redo, magnifiers for zoom - drawn inline as 24x24 SVG so the app needs
 * no icon font, sprite sheet or third-party dependency to render them.
 *
 * Everything is stroked in `currentColor` at a uniform 2px with round caps, so an icon inherits
 * the button's own text color (including the dimmed color of a disabled button) and stays
 * visually consistent with the rest of the set. The few glyphs that read better solid - the
 * play triangle, the stop square, the pause and step bars - say so per shape.
 */
export type IconName =
  | 'save'
  | 'folderOpen'
  | 'download'
  | 'play'
  | 'stop'
  | 'pause'
  | 'step'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'zoomSelection'
  | 'rotateCw'
  | 'rotateCcw'
  | 'flipHorizontal'
  | 'grid'
  | 'tips'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignTop'
  | 'alignMiddle'
  | 'alignBottom'
  | 'distributeH'
  | 'distributeV';

type Shape = [tag: string, attrs: Record<string, string | number>];

const FILLED = { fill: 'currentColor', stroke: 'none' } as const;

const ICONS: Record<IconName, Shape[]> = {
  save: [
    ['path', { d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z' }],
    ['path', { d: 'M17 21v-8H7v8' }],
    ['path', { d: 'M7 3v5h8' }],
  ],
  folderOpen: [
    [
      'path',
      { d: 'M4 20h14.5a2 2 0 0 0 1.94-1.5l1.55-6A2 2 0 0 0 20 10H9.24a2 2 0 0 0-1.79 1.1L6 14' },
    ],
    [
      'path',
      {
        d: 'M2 18V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2',
      },
    ],
  ],
  download: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['path', { d: 'm7 10 5 5 5-5' }],
    ['path', { d: 'M12 15V3' }],
  ],
  play: [['path', { d: 'M6 3.5 20 12 6 20.5Z', ...FILLED }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 1.5, ...FILLED }]],
  pause: [
    ['rect', { x: 6, y: 4.5, width: 4, height: 15, rx: 1, ...FILLED }],
    ['rect', { x: 14, y: 4.5, width: 4, height: 15, rx: 1, ...FILLED }],
  ],
  step: [
    ['path', { d: 'M5 4.5 16 12 5 19.5Z', ...FILLED }],
    ['rect', { x: 17.5, y: 4.5, width: 3, height: 15, rx: 1, ...FILLED }],
  ],
  undo: [
    ['path', { d: 'M9 14 4 9l5-5' }],
    ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H10' }],
  ],
  redo: [
    ['path', { d: 'm15 14 5-5-5-5' }],
    ['path', { d: 'M20 9H9.5a5.5 5.5 0 0 0 0 11H14' }],
  ],
  zoomIn: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['path', { d: 'm21 21-4.35-4.35' }],
    ['path', { d: 'M11 8v6' }],
    ['path', { d: 'M8 11h6' }],
  ],
  zoomOut: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['path', { d: 'm21 21-4.35-4.35' }],
    ['path', { d: 'M8 11h6' }],
  ],
  fit: [
    ['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }],
    ['path', { d: 'M21 8V5a2 2 0 0 0-2-2h-3' }],
    ['path', { d: 'M3 16v3a2 2 0 0 0 2 2h3' }],
    ['path', { d: 'M16 21h3a2 2 0 0 0 2-2v-3' }],
  ],
  // The fit icon's own frame corners with the selection sitting inside them.
  zoomSelection: [
    ['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }],
    ['path', { d: 'M21 8V5a2 2 0 0 0-2-2h-3' }],
    ['path', { d: 'M3 16v3a2 2 0 0 0 2 2h3' }],
    ['path', { d: 'M16 21h3a2 2 0 0 0 2-2v-3' }],
    ['rect', { x: 8.5, y: 8.5, width: 7, height: 7, rx: 1 }],
  ],
  rotateCw: [
    ['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
  ],
  rotateCcw: [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9c-2.52 0-4.93 1-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
  ],
  flipHorizontal: [
    ['path', { d: 'M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3' }],
    ['path', { d: 'M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3' }],
    ['path', { d: 'M12 2v2' }],
    ['path', { d: 'M12 8v2' }],
    ['path', { d: 'M12 14v2' }],
    ['path', { d: 'M12 20v2' }],
  ],
  grid: [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['path', { d: 'M9 3v18' }],
    ['path', { d: 'M15 3v18' }],
    ['path', { d: 'M3 9h18' }],
    ['path', { d: 'M3 15h18' }],
  ],
  tips: [
    ['path', { d: 'M9 14c-.2-1-.8-1.8-1.5-2.5A5.5 5.5 0 1 1 16.5 11.5c-.7.7-1.3 1.5-1.5 2.5' }],
    ['path', { d: 'M9 17h6' }],
    ['path', { d: 'M10 21h4' }],
  ],
  alignLeft: [
    ['path', { d: 'M4 2v20' }],
    ['rect', { x: 8, y: 5, width: 12, height: 5, rx: 1 }],
    ['rect', { x: 8, y: 14, width: 7, height: 5, rx: 1 }],
  ],
  alignCenter: [
    ['path', { d: 'M12 2v20' }],
    ['rect', { x: 6, y: 5, width: 12, height: 5, rx: 1 }],
    ['rect', { x: 8.5, y: 14, width: 7, height: 5, rx: 1 }],
  ],
  alignRight: [
    ['path', { d: 'M20 2v20' }],
    ['rect', { x: 4, y: 5, width: 12, height: 5, rx: 1 }],
    ['rect', { x: 9, y: 14, width: 7, height: 5, rx: 1 }],
  ],
  alignTop: [
    ['path', { d: 'M2 4h20' }],
    ['rect', { x: 5, y: 8, width: 5, height: 12, rx: 1 }],
    ['rect', { x: 14, y: 8, width: 5, height: 7, rx: 1 }],
  ],
  alignMiddle: [
    ['path', { d: 'M2 12h20' }],
    ['rect', { x: 5, y: 6, width: 5, height: 12, rx: 1 }],
    ['rect', { x: 14, y: 8.5, width: 5, height: 7, rx: 1 }],
  ],
  alignBottom: [
    ['path', { d: 'M2 20h20' }],
    ['rect', { x: 5, y: 4, width: 5, height: 12, rx: 1 }],
    ['rect', { x: 14, y: 9, width: 5, height: 7, rx: 1 }],
  ],
  distributeH: [
    ['path', { d: 'M2 3v18' }],
    ['path', { d: 'M22 3v18' }],
    ['rect', { x: 6, y: 7, width: 4, height: 10, rx: 1 }],
    ['rect', { x: 14, y: 7, width: 4, height: 10, rx: 1 }],
  ],
  distributeV: [
    ['path', { d: 'M3 2h18' }],
    ['path', { d: 'M3 22h18' }],
    ['rect', { x: 7, y: 6, width: 10, height: 4, rx: 1 }],
    ['rect', { x: 7, y: 14, width: 10, height: 4, rx: 1 }],
  ],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds one icon. It carries `aria-hidden` because every button that uses it also has its own
 * `aria-label`/`title` - without that the label would be announced twice. */
export function createIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  for (const [tag, attrs] of ICONS[name]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.appendChild(el);
  }
  return svg;
}
