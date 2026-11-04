// render/svg.js
//
// Deliberately dumb SVG renderer plus pointer/keyboard input handling. It maps
// a document to shapes and maps user gestures to operations, emitting them via
// `onOperation`. It contains no game logic and never mutates the document.

import { WORLD, BANK, bankLayout, COLORS, SIZES, clamp, clampZoom, MIN_ZOOM, MAX_ZOOM, pieceFacing } from '../core/state.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

// Side length of a piece in world units, by Homeworlds size (1/2/3 =
// small/medium/large). Larger sizes are drawn visibly larger so relative size
// reads at a glance. The Bank cell in core/state.js is sized for the largest.
export const PIECE_SIZES = Object.freeze({ 1: 56, 2: 68, 3: 80 });

export function pieceSize(size) {
  return PIECE_SIZES[size] || PIECE_SIZES[3];
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

export function createRenderer(svg, options = {}) {
  const emit = typeof options.onOperation === 'function' ? options.onOperation : () => {};
  // The local player's role, read lazily on every paint: a ship's direction is
  // derived from its owner and this role, so it must be current when rendering.
  const getLocalRole = typeof options.getLocalRole === 'function' ? options.getLocalRole : () => 'host';
  let board = null;
  let draggingId = null;
  const remotePresence = { cursor: null, draggingId: null, name: '' };
  let view = { w: svg.clientWidth || 960, h: svg.clientHeight || 640 };

  // The table edge: a fixed rectangle in world coordinates, so it pans and
  // zooms with the camera and marks exactly where the field ends.
  const boundary = el('rect', {
    class: 'board-boundary',
    x: 0,
    y: 0,
    width: WORLD.width,
    height: WORLD.height,
  });
  const slots = el('g', { class: 'bank-slots' });
  const pieces = el('g', { class: 'board-pieces' });
  // Opponent presence (cursor + drag highlight) lives above the pieces and is
  // never part of the document.
  const presenceLayer = el('g', { class: 'presence-layer' });

  const layout = bankLayout();
  for (const color of COLORS) {
    for (const size of SIZES) {
      const cell = layout.cellFor(color, size);
      const s = pieceSize(size);
      const slotW = s + 14;
      const slotH = s * 1.24 + 16; // tall enough for a triangle of this size
      for (let copy = 0; copy < BANK.copies; copy++) {
        slots.appendChild(
          el('rect', {
            x: cell.centerX + BANK.copyOffsets[copy] - slotW / 2,
            y: cell.centerY - slotH / 2,
            width: slotW,
            height: slotH,
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
  svg.appendChild(presenceLayer);

  function updateViewBox() {
    if (!board) return;
    const cam = board.camera;
    const w = view.w / cam.zoom;
    const h = view.h / cam.zoom;
    const x = cam.x - w / 2;
    const y = cam.y - h / 2;
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    // `boundary` is pinned in world coordinates (see above), so it needs no
    // update here: it moves with the viewBox and marks the real table edge.
  }

  // Set once a fit is requested before the board has a size; the first valid
  // measurement then performs it, so the initial zoom is never computed from
  // the pre-layout fallback viewport.
  let pendingFit = false;

  function measure() {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      view = { w: rect.width, h: rect.height };
    }
    if (pendingFit) {
      pendingFit = false;
      fitToWorld();
    }
    updateViewBox();
  }

  function pointerPx(event) {
    const rect = svg.getBoundingClientRect();
    return { px: event.clientX - rect.left, py: event.clientY - rect.top, rect };
  }

  function toWorld(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return screenToWorld(currentCamera(), view, clientX - rect.left, clientY - rect.top);
  }

  function currentCamera() {
    return board ? board.camera : { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 1 };
  }

  // Every camera that leaves the renderer is first clamped to the world, so a
  // player can never pan the field off-screen and the synced value is always
  // valid. `view` is read at call time, so it tracks resizes.
  function clampCurrent(camera) {
    return clampCamera(camera, view, WORLD);
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

  function renderPiece(piece) {
    const size = pieceSize(piece.size);
    // Direction is per viewer: a ship points up for its owner and down for the
    // other player. Never read a stored rotation — none is kept.
    const rotation = pieceFacing(piece, getLocalRole());
    const group = el('g', {
      class: `piece piece-${piece.kind} color-${piece.color}`,
      'data-id': piece.id,
      transform: `translate(${piece.x} ${piece.y}) rotate(${rotation})`,
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
    pieces.replaceChildren();
    const all = Object.values(board.pieces);
    // The piece being dragged is drawn last so it sits above the others.
    all.sort((a, b) => (a.id === draggingId ? 1 : 0) - (b.id === draggingId ? 1 : 0));
    for (const piece of all) {
      const node = renderPiece(piece);
      if (piece.id === draggingId) node.classList.add('dragging');
      pieces.appendChild(node);
    }
    applyDragHighlight();
    updateViewBox();
  }

  // --- Opponent presence --------------------------------------------------

  function applyDragHighlight() {
    for (const node of pieces.children) {
      node.classList.toggle('remote-dragging', node.dataset.id === remotePresence.draggingId);
    }
  }

  function renderPresence() {
    presenceLayer.replaceChildren();
    const { cursor, name } = remotePresence;
    if (!cursor) return;
    const group = el('g', {
      class: 'remote-cursor',
      transform: `translate(${cursor.x} ${cursor.y})`,
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
    presenceLayer.appendChild(group);
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
  // One pointer drags a piece (move) or pans the background; two pointers
  // pinch-zoom.

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

  function emitMove(id, event, final) {
    const world = toWorld(event.clientX, event.clientY);
    const op = {
      type: 'move',
      id,
      x: world.x + drag.offsetX,
      y: world.y + drag.offsetY,
      final: !!final,
    };
    if (final) {
      // The release is authoritative: drop any throttled intermediate and send
      // the exact final position.
      moveThrottle.cancel();
      emit(op);
    } else {
      moveThrottle.push(op);
    }
  }

  function startDrag(id, event) {
    const piece = board?.pieces?.[id];
    if (!piece) return;
    const world = toWorld(event.clientX, event.clientY);
    drag = {
      id,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      offsetX: piece.x - world.x,
      offsetY: piece.y - world.y,
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
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...currentCamera() } };
    svg.setPointerCapture?.(event.pointerId);
    svg.style.cursor = 'grabbing';
  });

  svg.addEventListener('pointermove', (event) => {
    emitCursor(event);
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

    if (drag && event.pointerId === drag.pointerId) {
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > TAP_MOVE_LIMIT) {
        drag.moved = true;
        if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
        // Only now rebuild the pieces: a press that never moves must not
        // replace the node, or a native double-click (flip) can never fire.
        // Capture too, so the drag keeps tracking if the pointer leaves the board.
        svg.setPointerCapture?.(event.pointerId);
        draggingId = drag.id;
        render(board);
      }
      if (drag.moved) emitMove(drag.id, event, false);
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
    if (drag && event.pointerId === drag.pointerId) {
      if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
      const moved = drag.moved;
      if (moved) {
        emitMove(drag.id, event, true);
      } else if (drag.pointerType === 'touch') {
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
      svg.style.cursor = '';
    }
    // Paint the true final state: flush a trailing camera update (and any move
    // that was throttled without a final).
    moveThrottle.flush();
    cameraThrottle.flush();
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  // Right-click flips a piece between triangle (ship) and square (star).
  svg.addEventListener('contextmenu', (event) => {
    const id = pieceFromEvent(event);
    if (!id) return;
    event.preventDefault();
    emit({ type: 'flip', id });
  });

  // Double-click sends a piece back home to its Bank slot.
  svg.addEventListener('dblclick', (event) => {
    const id = pieceFromEvent(event);
    if (!id) return;
    event.preventDefault();
    emit({ type: 'send-home', id });
  });

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

  // Fit the whole world (including the right-edge Bank) into the viewport,
  // centred on the world centre, with a clamped zoom. A little margin
  // (`FIT_MARGIN`) keeps the table edge off the screen border on first paint.
  // Used when there is no saved document; sent immediately (not throttled) so
  // the board is correct from the first frame.
  const FIT_MARGIN = 0.9;
  function fitToWorld() {
    const rect = svg.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) {
      // Not laid out yet: fit on the next measurement instead (see `measure`).
      pendingFit = true;
      return null;
    }
    view = { w: rect.width, h: rect.height };
    const zoom = clampZoom(Math.min(view.w / WORLD.width, view.h / WORLD.height) * FIT_MARGIN);
    const camera = clampCurrent({ x: WORLD.width / 2, y: WORLD.height / 2, zoom });
    sendCamera(camera);
    return camera;
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
