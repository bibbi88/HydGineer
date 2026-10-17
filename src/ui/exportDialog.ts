import type { ViewportAdapter } from './viewport';
import { getPageFrameWorldBounds } from './pageFrame';
import { computeVisibleWorldBounds } from '../interaction/fitViewToBounds';
import { computeContentBounds } from '../geometry/contentBounds';
import {
  buildExportSvg,
  exportProjectAsSvg,
  exportProjectAsPng,
  type ExportRegion,
} from '../persistence/exportImage';

type RegionChoice = 'auto' | 'frame' | 'view';

interface RegionOption {
  value: RegionChoice;
  label: string;
  hint: string;
}

const REGION_OPTIONS: RegionOption[] = [
  { value: 'auto', label: 'Everything', hint: 'Every component, auto-cropped with a small margin.' },
  { value: 'frame', label: 'Page frame', hint: 'The sheet the frame outlines, plus a small margin.' },
  { value: 'view', label: 'Current view', hint: "Whatever's on screen right now - pan/zoom first to pick a region." },
];

// Same margin exportImage.ts's own 'auto' crop adds around the diagram - applied here too so the
// frame's own border isn't flush against the exported image's edge. 'view' gets none: the user
// already framed exactly what they want by panning/zooming, so padding past that would show more
// than they picked.
const FRAME_EXPORT_PADDING = 40;

/** Resolves a region choice to the actual world rect it means right now - 'frame' and 'view' are
 * only meaningful in the moment (the frame can be off, the view can move), so this is called
 * fresh on every selection change and again right before the actual export, never cached. */
function resolveRegion(
  choice: RegionChoice,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): ExportRegion {
  if (choice === 'frame') {
    const bounds = getPageFrameWorldBounds();
    if (!bounds) return 'auto';
    return {
      minX: bounds.minX - FRAME_EXPORT_PADDING,
      minY: bounds.minY - FRAME_EXPORT_PADDING,
      maxX: bounds.maxX + FRAME_EXPORT_PADDING,
      maxY: bounds.maxY + FRAME_EXPORT_PADDING,
    };
  }
  if (choice === 'view') return computeVisibleWorldBounds(viewport, workspaceEl);
  return 'auto';
}

export function openExportDialog(
  name: string,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  const frameActive = getPageFrameWorldBounds() !== null;
  const hasContent = computeContentBounds() !== null;
  let choice: RegionChoice = frameActive ? 'frame' : 'auto';

  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const dialog = document.createElement('div');
  dialog.className = 'exportDialog';
  backdrop.appendChild(dialog);

  const header = document.createElement('div');
  header.className = 'exportDialogHeader';
  const title = document.createElement('h2');
  title.textContent = 'Export';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'exportDialogClose';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  header.append(title, closeBtn);
  dialog.appendChild(header);

  const regionRow = document.createElement('div');
  regionRow.className = 'exportRegionRow';
  dialog.appendChild(regionRow);

  const hint = document.createElement('p');
  hint.className = 'exportDialogHint';
  dialog.appendChild(hint);

  const previewBox = document.createElement('div');
  previewBox.className = 'exportPreviewBox';
  dialog.appendChild(previewBox);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'exportDialogButtons';
  const svgBtn = document.createElement('button');
  svgBtn.className = 'btn';
  svgBtn.textContent = 'Export as SVG';
  const pngBtn = document.createElement('button');
  pngBtn.className = 'btn';
  pngBtn.textContent = 'Export as PNG';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => close());
  buttonRow.append(svgBtn, pngBtn, cancelBtn);
  dialog.appendChild(buttonRow);

  function close(): void {
    backdrop.remove();
    window.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  window.addEventListener('keydown', onKeydown);

  function refresh(): void {
    regionRow.replaceChildren();
    for (const opt of REGION_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'exportRegionBtn';
      btn.classList.toggle('selected', choice === opt.value);
      btn.textContent = opt.label;
      btn.disabled = opt.value === 'frame' && !frameActive;
      btn.addEventListener('click', () => {
        choice = opt.value;
        refresh();
      });
      regionRow.appendChild(btn);
    }
    hint.textContent = REGION_OPTIONS.find((o) => o.value === choice)?.hint ?? '';

    previewBox.replaceChildren();
    if (!hasContent && choice === 'auto') {
      const empty = document.createElement('p');
      empty.className = 'exportPreviewEmpty';
      empty.textContent = 'Nothing on the canvas yet.';
      previewBox.appendChild(empty);
      svgBtn.disabled = true;
      pngBtn.disabled = true;
      return;
    }
    svgBtn.disabled = false;
    pngBtn.disabled = false;
    const region = resolveRegion(choice, viewport, workspaceEl);
    const preview = buildExportSvg(connLayer, frameLayer, region);
    preview.classList.add('exportPreviewSvg');
    previewBox.appendChild(preview);
  }

  svgBtn.addEventListener('click', () => {
    exportProjectAsSvg(name, connLayer, frameLayer, resolveRegion(choice, viewport, workspaceEl));
    close();
  });
  pngBtn.addEventListener('click', () => {
    void exportProjectAsPng(
      name,
      connLayer,
      frameLayer,
      resolveRegion(choice, viewport, workspaceEl),
    );
    close();
  });

  refresh();
  document.body.appendChild(backdrop);
}
