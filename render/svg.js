// render/svg.js
//
// Deliberately dumb SVG renderer plus pointer/keyboard input handling. It maps
// a document to shapes and maps user gestures to operations, emitting them via
// `onOperation`. It contains no game logic and never mutates the document.
//
// The board and the Bank are two SVGs sharing one document: the board is a
// pan/zoom window onto the play field, the Bank is a fixed window onto the
// Bank strip. Each renders every piece and its viewBox clips the rest. The
// world coordinates are the single source of truth, so sync and persistence
// are unchanged.

import {
  WORLD,
  BANK,
  bankLayout,
  bankStrip,
  playfieldWidth,
  COLORS,
  SIZES,
  clamp,
  clampZoom,
  INITIAL_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
  pieceFacing,
} from '../core/state.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

// Side length of a piece in world units, by Homeworlds size (1/2/3 =
// small/medium/large). Larger sizes are drawn visibly larger so relative size
// reads at a glance. The Bank cell in core/state.js is sized for the largest.
export const PIECE_SIZES = Object.freeze({ 1: 56, 2: 68, 3: 80 });

export function pieceSize(size) {
  return PIECE_SIZES[size] || PIECE_SIZES[3];
}

// The play field is drawn mirrored top-to-bottom for one role, so each player
// sees their own pieces at the bottom and the opponent's at the top: a piece the
// host drops low (large y) shows up high for the guest. The host is the
// identity; the guest is flipped about the field's middle. The map is an
// involution, so the same call converts world y → view y and view y → world y.
export function mirrorY(y, localRole) {
  return localRole === 'guest' ? WORLD.height - y : y;
}

const COLOR_VAR = {
  yellow: 'var(--yellow)',
  green: 'var(--green)',
  red: 'var(--red)',
  blue: 'var(--blue)',
};

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function trianglePoints(size) {
  const s = pieceSize(size);
  const h = s * 0.62;
  const w = s * 0.5;
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

// Clamp a camera so the visible world region stays inside the world. The
// viewport is `view.w / zoom` by `view.h / zoom` world units; on an axis where
// it is larger than the world, the camera is centred on that axis instead. This
// is what stops a player panning until the field is lost off-screen.
export function clampCamera(camera, view, world) {
  const zoom = clampZoom(camera.zoom);
  const x = Number.isFinite(camera.x) ? camera.x : world.width / 2;
  const y = Number.isFinite(camera.y) ? camera.y : world.height / 2;
  return {
    x: clampAxis(x, view.w / (2 * zoom), world.width),
    y: clampAxis(y, view.h / (2 * zoom), world.height),
    zoom,
  };
}

function clampAxis(center, half, extent) {
  if (half * 2 >= extent) return extent / 2;
  return clamp(center, half, extent - half);
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

// Map a point in a fixed-viewBox SVG (the Bank) to and from world coordinates.
// `rect` is the element's client rect; `preserveAspectRatio="xMidYMid meet"` is
// honoured the same way the browser lays it out, so a point under the cursor
// lands on the right world spot even before the panel matches the viewBox.
function viewBoxMapping(vb, rect) {
  const scale = Math.min(rect.width / vb.w, rect.height / vb.h) || 1;
  return {
    scale,
    offsetX: (rect.width - vb.w * scale) / 2,
    offsetY: (rect.height - vb.h * scale) / 2,
  };
}

function viewBoxToWorld(vb, rect, px, py) {
  const { scale, offsetX, offsetY } = viewBoxMapping(vb, rect);
  return { x: vb.x + (px - offsetX) / scale, y: vb.y + (py - offsetY) / scale };
}

function worldToViewBox(vb, rect, wx, wy) {
  const { scale, offsetX, offsetY } = viewBoxMapping(vb, rect);
  return { x: offsetX + (wx - vb.x) * scale, y: offsetY + (wy - vb.y) * scale };
}

function within(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function createRenderer(boardSvg, options = {}) {
  const emit = typeof options.onOperation === 'function' ? options.onOperation : () => {};
  // The local player's role, read lazily on every paint: a ship's direction is
  // derived from its owner and this role, so it must be current when rendering.
  const getLocalRole = typeof options.getLocalRole === 'function' ? options.getLocalRole : () => 'host';
  // Vertical mirror of the play field for the local viewer (see `mirrorY`).
  // Read lazily, like the role, so a create/join repaint flips the field at
  // once. `toWorldY` is the same involution, named for the other direction.
  const toViewY = (y) => mirrorY(y, getLocalRole());
  const toWorldY = toViewY;
  const bankSvg = options.bankSvg || null;
  let board = null;
  let draggingId = null;
  const remotePresence = { cursor: null, draggingId: null, name: '' };
  let view = { w: boardSvg.clientWidth || 960, h: boardSvg.clientHeight || 640 };

  // The table edge: a fixed rectangle in world coordinates, so it pans and
  // zooms with the board camera and marks exactly where the field ends. It is
  // the play field only — the Bank lives outside it, in its own panel.
  const boundary = el('rect', {
    class: 'board-boundary',
    x: 0,
    y: 0,
    width: playfieldWidth(),
    height: WORLD.height,
  });
  const slots = el('g', { class: 'bank-slots' });
  const boardPieces = el('g', { class: 'board-pieces' });
  const bankPieces = el('g', { class: 'bank-pieces' });
  // Opponent presence (cursor + drag highlight) lives above the pieces and is
  // never part of the document. Drawn in both windows so a peer over the Bank
  // is visible there too.
  const boardPresence = el('g', { class: 'presence-layer' });
  const bankPresence = el('g', { class: 'presence-layer' });

  // Clamp everything on the board to the play field. The camera is clamped to
  // the same rectangle, but when zoomed out past it the viewBox spreads beyond
  // the field; this clip keeps Bank pieces from leaking onto the board there.
  const clipId = `hw-playfield-${Math.random().toString(36).slice(2)}`;
  const defs = el('defs');
  const clip = el('clipPath', { id: clipId });
  clip.appendChild(el('rect', { x: 0, y: 0, width: playfieldWidth(), height: WORLD.height }));
  defs.appendChild(clip);
  boardPieces.setAttribute('clip-path', `url(#${clipId})`);
  boardPresence.setAttribute('clip-path', `url(#${clipId})`);

  // One static backdrop per Bank cell. The three overlapping copies sit inside
  // it; nothing reflows when a copy is taken.
  const layout = bankLayout();
  for (const color of COLORS) {
    for (const size of SIZES) {
      const cell = layout.cellFor(color, size);
      const cellW = BANK.cellWidth - 12;
      const cellH = BANK.cellHeight - 12;
      slots.appendChild(
        el('rect', {
          x: cell.centerX - cellW / 2,
          y: cell.centerY - cellH / 2,
          width: cellW,
          height: cellH,
          rx: 12,
          class: 'bank-slot',
        }),
      );
    }
  }

  boardSvg.appendChild(defs);
  boardSvg.appendChild(boundary);
  boardSvg.appendChild(boardPieces);
  boardSvg.appendChild(boardPresence);
  if (bankSvg) {
    bankSvg.appendChild(slots);
    bankSvg.appendChild(bankPieces);
    bankSvg.appendChild(bankPresence);
  }

  function currentCamera() {
    return board
      ? board.camera
      : { x: playfieldWidth() / 2, y: WORLD.height / 2, zoom: INITIAL_ZOOM };
  }
  // The stored camera is in world coordinates and shared; the board is drawn in
  // the local *view*, which is the world mirrored for one role. These convert
  // between the two so sync and persistence keep using world coordinates.
  function viewCamera() {
    const cam = currentCamera();
    return { x: cam.x, y: toViewY(cam.y), zoom: cam.zoom };
  }
  function fromViewCamera(cam) {
    return { x: cam.x, y: toWorldY(cam.y), zoom: cam.zoom };
  }

  function updateViewBox() {
    if (!board) return;
    const cam = viewCamera();
    const w = view.w / cam.zoom;
    const h = view.h / cam.zoom;
    const x = cam.x - w / 2;
    const y = cam.y - h / 2;
    boardSvg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }

  // The Bank window is pinned to the Bank strip. Its viewBox is expanded (and
  // only expanded) to match the panel's aspect ratio, so the content is never
  // cropped and the screen↔world mapping stays uniform.
  function bankViewBox() {
    const strip = bankStrip();
    const margin = 36;
    let x = strip.x - margin;
    let y = strip.y - margin;
    let w = strip.width + margin * 2;
    let h = strip.height + margin * 2;
    if (bankSvg) {
      const rect = bankSvg.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const aspect = rect.width / rect.height;
        if (w / h < aspect) {
          const nextW = h * aspect;
          x -= (nextW - w) / 2;
          w = nextW;
        } else if (w / h > aspect) {
          const nextH = w / aspect;
          y -= (nextH - h) / 2;
          h = nextH;
        }
      }
    }
    return { x, y, w, h };
  }

  function updateBankViewBox() {
    if (!bankSvg) return;
    const vb = bankViewBox();
    bankSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  // Which panel is a client point over? Falls back to the nearer panel when the
  // point is outside both (e.g. in the gap or the surrounding page).
  function panelAt(clientX, clientY) {
    const bRect = boardSvg.getBoundingClientRect();
    if (within(bRect, clientX, clientY)) return 'board';
    if (!bankSvg) return 'board';
    const kRect = bankSvg.getBoundingClientRect();
    if (within(kRect, clientX, clientY)) return 'bank';
    const bMid = (bRect.left + bRect.right) / 2;
    const kMid = (kRect.left + kRect.right) / 2;
    return Math.abs(clientX - bMid) <= Math.abs(clientX - kMid) ? 'board' : 'bank';
  }

  function toWorld(clientX, clientY) {
    if (bankSvg && panelAt(clientX, clientY) === 'bank') {
      const rect = bankSvg.getBoundingClientRect();
      return viewBoxToWorld(bankViewBox(), rect, clientX - rect.left, clientY - rect.top);
    }
    const rect = boardSvg.getBoundingClientRect();
    const v = screenToWorld(viewCamera(), view, clientX - rect.left, clientY - rect.top);
    return { x: v.x, y: toWorldY(v.y) };
  }

  // The client position a piece is drawn at in a given panel. Used to keep the
  // grab offset consistent while a drag crosses the board ↔ Bank seam.
  function pieceScreen(piece, panel) {
    if (bankSvg && panel === 'bank') {
      const rect = bankSvg.getBoundingClientRect();
      const p = worldToViewBox(bankViewBox(), rect, piece.x, piece.y);
      return { x: rect.left + p.x, y: rect.top + p.y };
    }
    const rect = boardSvg.getBoundingClientRect();
    const p = worldToScreen(viewCamera(), view, piece.x, toViewY(piece.y));
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  // Set once a fit is requested before the board has a size; the first valid
  // measurement then performs it, so the initial zoom is never computed from
  // the pre-layout fallback viewport.
  let pendingFit = false;

  function measure() {
    const rect = boardSvg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      view = { w: rect.width, h: rect.height };
    }
    if (pendingFit) {
      pendingFit = false;
      fitToWorld();
    }
    updateViewBox();
    updateBankViewBox();
  }

  function pointerPx(event) {
    const rect = boardSvg.getBoundingClientRect();
    return { px: event.clientX - rect.left, py: event.clientY - rect.top, rect };
  }

  // Every camera that leaves the renderer is first clamped to the play field,
  // so a player can never pan the field off-screen (and the Bank panel can
  // never bleed into the board). `view` is read at call time, so it resizes.
  function clampCurrent(camera) {
    return clampCamera(camera, view, { width: playfieldWidth(), height: WORLD.height });
  }

  function emitCamera(camera) {
    cameraThrottle.push(clampCurrent(camera));
  }

  function sendCamera(camera) {
    const clamped = clampCurrent(camera);
    emit({ type: 'camera', camera: { x: clamped.x, y: clamped.y, zoom: clamped.zoom } });
  }

  // Trailing throttle: at most one update per interval, keeping only the latest
  // pending value and always flushing it, so the final position is never lost.
  function throttle(intervalMs, send) {
    let last = 0;
    let timer = null;
    let pending = null;
    let hasPending = false;

    function fire() {
      timer = null;
      hasPending = false;
      last = Date.now();
      const value = pending;
      pending = null;
      send(value);
    }

    return {
      push(value) {
        pending = value;
        hasPending = true;
        const wait = intervalMs - (Date.now() - last);
        if (wait <= 0) {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          fire();
        } else if (!timer) {
          timer = setTimeout(fire, wait);
        }
      },
      flush() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (hasPending) fire();
      },
      cancel() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        pending = null;
        hasPending = false;
      },
    };
  }

  // Drag and camera are throttled to ~30 updates/s; the release and a trailing
  // camera flush are sent immediately.
  const EMIT_INTERVAL_MS = 33;
  const moveThrottle = throttle(EMIT_INTERVAL_MS, (op) => emit(op));
  const cameraThrottle = throttle(EMIT_INTERVAL_MS, (camera) => sendCamera(camera));

  // Throttled cursor sharing: ~25 updates/s is smooth without flooding the
  // transport. The cursor is in world coordinates, so it pans and zooms with
  // the board on the opponent's screen.
  const CURSOR_INTERVAL_MS = 40;
  let lastCursorAt = 0;
  function emitCursor(event) {
    const now = Date.now();
    if (now - lastCursorAt < CURSOR_INTERVAL_MS) return;
    lastCursorAt = now;
    const world = toWorld(event.clientX, event.clientY);
    emit({ type: 'cursor', cursor: { x: world.x, y: world.y } });
  }

  // `mirror` draws the piece in the local play view (the board); the Bank panel
  // is a fixed reference, so its copy is never mirrored.
  function renderPiece(piece, mirror = false) {
    const size = pieceSize(piece.size);
    // Direction is per viewer: a ship points up for its owner and down for the
    // other player. Never read a stored rotation — none is kept.
    const rotation = pieceFacing(piece, getLocalRole());
    const y = mirror ? toViewY(piece.y) : piece.y;
    const group = el('g', {
      class: `piece piece-${piece.kind} color-${piece.color}`,
      'data-id': piece.id,
      transform: `translate(${piece.x} ${y}) rotate(${rotation})`,
    });

    if (piece.kind === 'star') {
      const s = size * 0.86;
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
          points: trianglePoints(piece.size),
          class: 'piece-shape',
          fill: COLOR_VAR[piece.color],
        }),
      );
    }

    // Size pips (1/2/3 dots), centred on the piece for visibility, in an
    // unrotated sub-group so they stay upright whichever way the piece points.
    const pips = el('g', { class: 'piece-pips', transform: `rotate(${-rotation})` });
    const gap = size * 0.16;
    const startY = -((piece.size - 1) * gap) / 2;
    for (let i = 0; i < piece.size; i++) {
      pips.appendChild(el('circle', { cx: 0, cy: startY + i * gap, r: size * 0.055, class: 'piece-pip' }));
    }
    group.appendChild(pips);

    return group;
  }

  function render(nextBoard) {
    board = nextBoard;
    boardPieces.replaceChildren();
    bankPieces.replaceChildren();
    const all = Object.values(board.pieces);
    // The piece being dragged is drawn last so it sits above the others.
    all.sort((a, b) => (a.id === draggingId ? 1 : 0) - (b.id === draggingId ? 1 : 0));
    for (const piece of all) {
      const node = renderPiece(piece, true);
      if (piece.id === draggingId) node.classList.add('dragging');
      boardPieces.appendChild(node);
      if (bankSvg) {
        const bankNode = renderPiece(piece, false);
        if (piece.id === draggingId) bankNode.classList.add('dragging');
        bankPieces.appendChild(bankNode);
      }
    }
    applyDragHighlight();
    updateViewBox();
    updateBankViewBox();
  }

  // --- Opponent presence --------------------------------------------------

  function applyDragHighlight() {
    for (const layer of [boardPieces, bankPieces]) {
      for (const node of layer.children) {
        node.classList.toggle('remote-dragging', node.dataset.id === remotePresence.draggingId);
      }
    }
  }

  function presenceMarker(cursor, name, mirror = false) {
    const y = mirror ? toViewY(cursor.y) : cursor.y;
    const group = el('g', {
      class: 'remote-cursor',
      transform: `translate(${cursor.x} ${y})`,
    });
    group.appendChild(
      el('path', {
        class: 'remote-cursor-arrow',
        d: 'M0,0 L0,22 L6,16 L11,26 L15,24 L10,14 L18,14 Z',
      }),
    );
    if (name) {
      const label = el('text', { class: 'remote-cursor-label', x: 16, y: 24 });
      label.textContent = name;
      group.appendChild(label);
    }
    return group;
  }

  function renderPresence() {
    boardPresence.replaceChildren();
    bankPresence.replaceChildren();
    const { cursor, name } = remotePresence;
    if (!cursor) return;
    boardPresence.appendChild(presenceMarker(cursor, name, true));
    if (bankSvg) bankPresence.appendChild(presenceMarker(cursor, name, false));
  }

  // Update what we know about the opponent. Each key is optional; `cursor` is
  // null when unknown, `draggingId` is null when they have released.
  function setPresence(patch = {}) {
    if ('cursor' in patch) remotePresence.cursor = patch.cursor || null;
    if ('draggingId' in patch) remotePresence.draggingId = patch.draggingId || null;
    if ('name' in patch) remotePresence.name = patch.name || '';
    renderPresence();
    applyDragHighlight();
  }

  // --- Pointer input ------------------------------------------------------
  //
  // One pointer drags a piece (move) or pans the board; two pointers
  // pinch-zoom. Drags are tracked in screen space, so a piece can be pulled
  // across the board ↔ Bank seam: the panel under the piece decides how the
  // screen maps to world.

  let pan = null;
  let drag = null;
  let pinch = null;
  let lastTouchTap = null;
  const activePointers = new Map();

  const TAP_MOVE_LIMIT = 8; // px before a press counts as a drag, not a tap
  const DOUBLE_TAP_MS = 320;
  const LONG_PRESS_MS = 500;

  function pieceFromEvent(event) {
    const node = event.target.closest && event.target.closest('.piece');
    return node && node.dataset.id ? node.dataset.id : null;
  }

  function emitMove(id, event) {
    const world = toWorld(event.clientX + drag.offsetX, event.clientY + drag.offsetY);
    moveThrottle.push({ type: 'move', id, x: world.x, y: world.y });
  }

  function startDrag(id, event) {
    const piece = board?.pieces?.[id];
    if (!piece) return;
    const screen = pieceScreen(piece, panelAt(event.clientX, event.clientY));
    drag = {
      id,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      // Grab offset in screen pixels, so it survives the panel scale change.
      offsetX: screen.x - event.clientX,
      offsetY: screen.y - event.clientY,
      longPressTimer: null,
    };
    // Pointer capture is deliberately NOT taken here: capturing on press would
    // retarget the derived mouse events (including dblclick) to the <svg>, so a
    // double-click could no longer be resolved to the piece under it. Capture
    // is taken once the gesture actually becomes a drag (see pointermove).
    emit({ type: 'drag', id, phase: 'start' });
    // Touch: holding still flips the piece after a moment.
    if (event.pointerType === 'touch') {
      drag.longPressTimer = setTimeout(() => {
        if (drag && drag.id === id && !drag.moved) {
          emit({ type: 'flip', id });
          if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
          emit({ type: 'drag', id, phase: 'end' });
          drag = null;
          draggingId = null;
          render(board);
        }
      }, LONG_PRESS_MS);
    }
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        camera: { ...viewCamera() },
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      pan = null;
      if (drag) {
        if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
        emit({ type: 'drag', id: drag.id, phase: 'end' });
        draggingId = null;
        drag = null;
      }
      return;
    }

    const id = pieceFromEvent(event);
    if (id) {
      startDrag(id, event);
      return;
    }
    // Only the board background pans; the Bank panel is fixed.
    if (event.currentTarget !== boardSvg) return;
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...viewCamera() } };
    boardSvg.setPointerCapture?.(event.pointerId);
    boardSvg.style.cursor = 'grabbing';
  }

  function onPointerMove(event) {
    emitCursor(event);
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pinch && activePointers.size >= 2) {
      const [a, b] = [...activePointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.distance > 0 && distance > 0) {
        const rect = boardSvg.getBoundingClientRect();
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const zoom = pinch.camera.zoom * (distance / pinch.distance);
        const anchor = { px: pinch.mid.x - rect.left, py: pinch.mid.y - rect.top };
        emitCamera(fromViewCamera(zoomAround(pinch.camera, view, anchor.px, anchor.py, zoom)));
      }
      return;
    }

    if (drag && event.pointerId === drag.pointerId) {
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > TAP_MOVE_LIMIT) {
        drag.moved = true;
        if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
        // Only now rebuild the pieces: a press that never moves must not
        // replace the node, or a native double-click (flip) can never fire.
        // Capture too, so the drag keeps tracking if the pointer leaves the board.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        draggingId = drag.id;
        render(board);
      }
      if (drag.moved) emitMove(drag.id, event);
      return;
    }

    if (pan && event.pointerId === pan.pointerId) {
      const dx = (event.clientX - pan.x) / pan.camera.zoom;
      const dy = (event.clientY - pan.y) / pan.camera.zoom;
      emitCamera(fromViewCamera({ x: pan.camera.x - dx, y: pan.camera.y - dy, zoom: pan.camera.zoom }));
    }
  }

  function endPointer(event) {
    // A `pointercancel` means the browser took the pointer over (e.g. a native
    // drag). Its coordinates are (0,0), so it must never be treated as a
    // release: that would fling the piece to the world origin. Cancel simply
    // ends the gesture at the last emitted position.
    const cancelled = event.type === 'pointercancel';
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinch = null;
    if (drag && event.pointerId === drag.pointerId) {
      if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
      const moved = drag.moved;
      if (moved && !cancelled) {
        moveThrottle.cancel();
        if (bankSvg && panelAt(event.clientX, event.clientY) === 'bank') {
          // Dropped on the Bank panel: send it home to its slot.
          emit({ type: 'send-home', id: drag.id });
        } else {
          // Dropped on the board: land where the pointer is.
          const world = toWorld(event.clientX, event.clientY);
          emit({ type: 'move', id: drag.id, x: world.x, y: world.y, final: true });
        }
      } else if (!moved && !cancelled && drag.pointerType === 'touch') {
        // A still tap: a second one shortly after sends the piece home.
        const now = Date.now();
        if (lastTouchTap && lastTouchTap.id === drag.id && now - lastTouchTap.time < DOUBLE_TAP_MS) {
          emit({ type: 'send-home', id: drag.id });
          lastTouchTap = null;
        } else {
          lastTouchTap = { id: drag.id, time: now };
        }
      }
      emit({ type: 'drag', id: drag.id, phase: 'end' });
      drag = null;
      draggingId = null;
      // A press that never moved left the DOM untouched; re-rendering here
      // would replace the node and rob the browser of its double-click.
      if (moved) render(board);
    }
    if (pan && event.pointerId === pan.pointerId) {
      pan = null;
      boardSvg.style.cursor = '';
    }
    // Paint the true final state: flush a trailing camera update (and any move
    // that was throttled without a final).
    moveThrottle.flush();
    cameraThrottle.flush();
  }

  function onContextMenu(event) {
    const id = pieceFromEvent(event);
    if (!id) return;
    event.preventDefault();
    emit({ type: 'flip', id });
  }

  function onDblclick(event) {
    const id = pieceFromEvent(event);
    if (!id) return;
    event.preventDefault();
    emit({ type: 'send-home', id });
  }

  function onWheel(event) {
    event.preventDefault();
    const cam = viewCamera();
    const { px, py } = pointerPx(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    emitCamera(fromViewCamera(zoomAround(cam, view, px, py, cam.zoom * factor)));
  }

  function attach(target) {
    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', endPointer);
    target.addEventListener('pointercancel', endPointer);
    target.addEventListener('contextmenu', onContextMenu);
    target.addEventListener('dblclick', onDblclick);
    // A press-and-drag on a piece can make the browser start a native HTML5
    // drag (and a text selection). That fires `pointercancel`, which would
    // abort the drag and, worse, its (0,0) coordinates used to fling the piece
    // to the world origin. Suppress both defaults.
    target.addEventListener('dragstart', (event) => event.preventDefault());
    target.addEventListener('selectstart', (event) => event.preventDefault());
  }

  attach(boardSvg);
  if (bankSvg) attach(bankSvg);
  boardSvg.addEventListener('wheel', onWheel, { passive: false });

  // +/− buttons and keyboard.
  function zoomBy(factor) {
    const cam = viewCamera();
    emitCamera(fromViewCamera({ x: cam.x, y: cam.y, zoom: cam.zoom * factor }));
  }

  // Fit the whole play field into the viewport, centred on the field centre,
  // with a clamped zoom. A little margin (`FIT_MARGIN`) keeps the table edge off
  // the screen border on first paint. The Bank panel is fixed and not part of
  // the fit. Used when there is no saved document; sent immediately (not
  // throttled) so the board is correct from the first frame.
  const FIT_MARGIN = 0.9;
  function fitToWorld() {
    const rect = boardSvg.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) {
      // Not laid out yet: fit on the next measurement instead (see `measure`).
      pendingFit = true;
      return null;
    }
    view = { w: rect.width, h: rect.height };
    const world = { width: playfieldWidth(), height: WORLD.height };
    const zoom = clampZoom(Math.min(view.w / world.width, view.h / world.height) * FIT_MARGIN);
    const camera = clampCurrent({ x: world.width / 2, y: world.height / 2, zoom });
    sendCamera(camera);
    return camera;
  }

  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    observer.observe(boardSvg);
    if (bankSvg) observer.observe(bankSvg);
  }

  return {
    svg: boardSvg,
    render,
    measure,
    fitToWorld,
    zoomBy,
    setPresence,
    getCamera: currentCamera,
    getView: () => view,
    // Clamp a camera (e.g. one arriving from the peer) to the local viewport.
    clampCamera: clampCurrent,
    toWorld,
    destroy() {
      observer?.disconnect();
      moveThrottle.cancel();
      cameraThrottle.cancel();
    },
  };
}

export { MIN_ZOOM, MAX_ZOOM, clamp };
