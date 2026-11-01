// render/svg.js
//
// Deliberately dumb SVG renderer plus pointer/keyboard input handling. It maps
// a document to shapes and maps user gestures to operations, emitting them via
// `onOperation`. It contains no game logic and never mutates the document.

import { WORLD, BANK, bankLayout, COLORS, SIZES, clamp, clampZoom } from '../core/state.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

// Side length of a piece triangle in world units.
export const PIECE_SIZE = 48;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

const COLOR_VAR = {
  yellow: 'var(--yellow)',
  green: 'var(--green)',
  red: 'var(--red)',
  blue: 'var(--blue)',
};

const COPY_OFFSETS = [-54, 0, 54];

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function trianglePoints() {
  const h = PIECE_SIZE * 0.62;
  const w = PIECE_SIZE * 0.5;
  return `0,${-h} ${-w},${h} ${w},${h}`;
}

// Camera maths. `camera` is { x, y, zoom } where (x, y) is the world point at
// the centre of the viewport.
export function screenToWorld(camera, view, px, py) {
  return {
    x: camera.x + (px - view.w / 2) / camera.zoom,
    y: camera.y + (py - view.h / 2) / camera.zoom,
  };
}

export function worldToScreen(camera, view, wx, wy) {
  return {
    x: view.w / 2 + (wx - camera.x) * camera.zoom,
    y: view.h / 2 + (wy - camera.y) * camera.zoom,
  };
}

// New camera that keeps the given screen anchor under the same world point
// while changing zoom to `nextZoom`.
export function zoomAround(camera, view, px, py, nextZoom) {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(camera, view, px, py);
  return {
    x: world.x - (px - view.w / 2) / zoom,
    y: world.y - (py - view.h / 2) / zoom,
    zoom,
  };
}

export function createRenderer(svg, options = {}) {
  const emit = typeof options.onOperation === 'function' ? options.onOperation : () => {};
  let board = null;
  let view = { w: svg.clientWidth || 960, h: svg.clientHeight || 640 };

  const boundary = el('rect', {
    x: 0,
    y: 0,
    width: WORLD.width,
    height: WORLD.height,
    class: 'board-boundary',
  });
  const slots = el('g', { class: 'bank-slots' });
  const pieces = el('g', { class: 'board-pieces' });

  const layout = bankLayout();
  for (const color of COLORS) {
    for (const size of SIZES) {
      const cell = layout.cellFor(color, size);
      for (let copy = 0; copy < BANK.copies; copy++) {
        slots.appendChild(
          el('rect', {
            x: cell.centerX + COPY_OFFSETS[copy] - PIECE_SIZE / 2 - 6,
            y: cell.centerY - PIECE_SIZE / 2 - 8,
            width: PIECE_SIZE + 12,
            height: PIECE_SIZE + 16,
            rx: 8,
            class: 'bank-slot',
          }),
        );
      }
    }
  }

  svg.appendChild(boundary);
  svg.appendChild(slots);
  svg.appendChild(pieces);

  function updateViewBox() {
    if (!board) return;
    const cam = board.camera;
    const w = view.w / cam.zoom;
    const h = view.h / cam.zoom;
    svg.setAttribute('viewBox', `${cam.x - w / 2} ${cam.y - h / 2} ${w} ${h}`);
  }

  function measure() {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      view = { w: rect.width, h: rect.height };
    }
    updateViewBox();
  }

  function pointerPx(event) {
    const rect = svg.getBoundingClientRect();
    return { px: event.clientX - rect.left, py: event.clientY - rect.top, rect };
  }

  function currentCamera() {
    return board ? board.camera : { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 1 };
  }

  function emitCamera(camera) {
    emit({ type: 'camera', camera: { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) } });
  }

  function renderPiece(piece) {
    const group = el('g', {
      class: `piece piece-${piece.kind} color-${piece.color}`,
      'data-id': piece.id,
      transform: `translate(${piece.x} ${piece.y}) rotate(${piece.rotation})`,
    });

    if (piece.kind === 'star') {
      const s = PIECE_SIZE * 0.86;
      group.appendChild(
        el('rect', {
          x: -s / 2,
          y: -s / 2,
          width: s,
          height: s,
          rx: 6,
          class: 'piece-shape',
          fill: COLOR_VAR[piece.color],
        }),
      );
    } else {
      group.appendChild(
        el('polygon', {
          points: trianglePoints(),
          class: 'piece-shape',
          fill: COLOR_VAR[piece.color],
        }),
      );
    }

    // Size pips, bottom-left corner, in an unrotated sub-group so they stay
    // readable whichever way the triangle points.
    const pips = el('g', { class: 'piece-pips', transform: `rotate(${-piece.rotation})` });
    const px = -PIECE_SIZE * 0.42;
    const py = PIECE_SIZE * 0.42;
    for (let i = 0; i < piece.size; i++) {
      pips.appendChild(el('circle', { cx: px, cy: py - i * 6, r: 2.4, class: 'piece-pip' }));
    }
    group.appendChild(pips);

    return group;
  }

  function render(nextBoard) {
    board = nextBoard;
    pieces.replaceChildren();
    for (const piece of Object.values(board.pieces)) {
      pieces.appendChild(renderPiece(piece));
    }
    updateViewBox();
  }

  // --- Camera input -------------------------------------------------------

  // Background drag pans; a piece drag is handled by later tickets.
  let pan = null;
  let pinch = null;
  const activePointers = new Map();

  svg.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        camera: { ...currentCamera() },
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      pan = null;
      return;
    }

    if (event.target.closest && event.target.closest('.piece')) return; // piece drag: later ticket
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...currentCamera() } };
    svg.setPointerCapture?.(event.pointerId);
    svg.style.cursor = 'grabbing';
  });

  svg.addEventListener('pointermove', (event) => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pinch && activePointers.size >= 2) {
      const [a, b] = [...activePointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.distance > 0 && distance > 0) {
        const rect = svg.getBoundingClientRect();
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const zoom = pinch.camera.zoom * (distance / pinch.distance);
        const anchor = { px: pinch.mid.x - rect.left, py: pinch.mid.y - rect.top };
        emitCamera(zoomAround(pinch.camera, view, anchor.px, anchor.py, zoom));
      }
      return;
    }

    if (pan && event.pointerId === pan.pointerId) {
      const dx = (event.clientX - pan.x) / pan.camera.zoom;
      const dy = (event.clientY - pan.y) / pan.camera.zoom;
      emitCamera({ x: pan.camera.x - dx, y: pan.camera.y - dy, zoom: pan.camera.zoom });
    }
  });

  function endPointer(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinch = null;
    if (pan && event.pointerId === pan.pointerId) {
      pan = null;
      svg.style.cursor = '';
    }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const cam = currentCamera();
      const { px, py } = pointerPx(event);
      const factor = Math.exp(-event.deltaY * 0.0015);
      emitCamera(zoomAround(cam, view, px, py, cam.zoom * factor));
    },
    { passive: false },
  );

  // +/− buttons and keyboard.
  function zoomBy(factor) {
    const cam = currentCamera();
    emitCamera({ x: cam.x, y: cam.y, zoom: cam.zoom * factor });
  }

  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    observer.observe(svg);
  }

  return {
    svg,
    render,
    measure,
    zoomBy,
    getCamera: currentCamera,
    getView: () => view,
    toWorld: (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      return screenToWorld(currentCamera(), view, clientX - rect.left, clientY - rect.top);
    },
    destroy() {
      observer?.disconnect();
    },
  };
}

export { MIN_ZOOM, MAX_ZOOM, clamp };
