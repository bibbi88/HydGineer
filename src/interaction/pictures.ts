import type { Component } from '../core/types';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import { snap } from '../core/grid';
import { INSERT_MAX_WIDTH, PICTURE_TYPE } from '../components/picture';
import { placeComponent } from './spawn';
import { selectOnly } from './selection';

/** Longest side, px, a picture is stored at - plenty for a diagram, and keeps the project (and
 * the browser's copy of every open circuit) small. */
const MAX_STORED_SIDE = 1600;
/** Above this many characters a PNG is stored as JPEG instead - a photo, most likely. */
const MAX_PNG_CHARS = 600_000;

export interface LoadedPicture {
  src: string;
  width: number;
  height: number;
}

/** Reads an image file into a data URL, scaled down to MAX_STORED_SIDE if it's bigger. */
export async function loadPictureFile(file: Blob): Promise<LoadedPicture> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_STORED_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas to read the picture with');
    ctx.drawImage(img, 0, 0, width, height);
    let src = canvas.toDataURL('image/png');
    if (src.length > MAX_PNG_CHARS) {
      // JPEG has no transparency: put the picture on white first.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      src = canvas.toDataURL('image/jpeg', 0.85);
    }
    return { src, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Puts `picture` into the picture component `comp`, shown at most INSERT_MAX_WIDTH wide. */
export function showPicture(comp: Component, picture: LoadedPicture): void {
  comp.restore({
    ...comp.snapshot(),
    src: picture.src,
    aspect: picture.height / picture.width,
    width: Math.min(INSERT_MAX_WIDTH, picture.width),
  });
  appState.markDirty();
}

/** Asks for an image file; resolves to it, or null if none was chosen. */
export function choosePictureFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Lets the user pick a picture for `comp`. */
export async function choosePictureFor(comp: Component): Promise<void> {
  if (!canEdit(appState.mode)) return;
  const file = await choosePictureFile();
  if (file) showPicture(comp, await loadPictureFile(file));
}

function imageFileIn(items: DataTransferItemList | undefined): File | null {
  for (const item of Array.from(items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}

let ctxRef: ComponentFactoryContext | null = null;
let viewportRef: ViewportAdapter | null = null;
let workspaceRef: HTMLElement | null = null;
/** Where the pointer last was over the canvas (world coordinates) - where a paste lands. */
let lastPointer: { x: number; y: number } | null = null;

/** A new picture holding `file`, centred at `world` and selected. */
export async function insertPicture(file: Blob, world: { x: number; y: number }): Promise<void> {
  if (!ctxRef || !viewportRef || !canEdit(appState.mode)) return;
  const picture = await loadPictureFile(file);
  const comp = placeComponent(PICTURE_TYPE, ctxRef, viewportRef, snap(world.x), snap(world.y));
  if (!comp) return;
  showPicture(comp, picture);
  selectOnly(comp.id);
}

function pastePoint(): { x: number; y: number } {
  if (lastPointer) return lastPointer;
  const rect = workspaceRef?.getBoundingClientRect();
  if (!rect || !viewportRef) return { x: 0, y: 0 };
  return viewportRef.clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

/**
 * A paste carrying a picture (a screenshot, an image copied from elsewhere) inserts it, where
 * the pointer is over the canvas - see keyboard.ts, which pastes copied components instead
 * whenever the paste brings no picture. Returns whether it took the paste.
 */
export function pastePictureFrom(data: DataTransfer | null): boolean {
  const file = imageFileIn(data?.items);
  if (!file) return false;
  void insertPicture(file, pastePoint());
  return true;
}

export function initPictures(
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  ctxRef = ctx;
  viewportRef = viewport;
  workspaceRef = workspaceEl;

  workspaceEl.addEventListener('mousemove', (e) => {
    lastPointer = viewport.clientToWorld(e.clientX, e.clientY);
  });
  workspaceEl.addEventListener('mouseleave', () => {
    lastPointer = null;
  });

  // An image file dragged in from the desktop or a file manager lands where it's dropped.
  workspaceEl.addEventListener('dragover', (e) => {
    if (!Array.from(e.dataTransfer?.items ?? []).some((i) => i.type.startsWith('image/'))) return;
    if (!canEdit(appState.mode)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  workspaceEl.addEventListener('drop', (e) => {
    const file = imageFileIn(e.dataTransfer?.items);
    if (!file || !canEdit(appState.mode)) return;
    e.preventDefault();
    void insertPicture(file, viewport.clientToWorld(e.clientX, e.clientY));
  });

  // Double-clicking a picture (or the empty frame of one placed from the library) picks its
  // image.
  workspaceEl.addEventListener('dblclick', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.comp');
    if (el?.dataset.type !== PICTURE_TYPE) return;
    const comp = appState.components.find((c) => c.el === el);
    if (comp) void choosePictureFor(comp);
  });
}
