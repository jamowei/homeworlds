// render/svg.js
//
// Deliberately dumb SVG renderer. It maps a document to shapes and (in later
// tickets) maps pointer gestures back to operations. No game logic lives here.

import { WORLD, BANK, bankLayout, COLORS, SIZES, pieceId } from '../core/state.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

// Side length of a piece triangle in world units.
export const PIECE_SIZE = 48;

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

export function createRenderer(svg) {
  svg.setAttribute('viewBox', `0 0 ${WORLD.width} ${WORLD.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Static layers, built once.
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
    const pips = el('g', {
      class: 'piece-pips',
      transform: `rotate(${-piece.rotation})`,
    });
    const px = -PIECE_SIZE * 0.42;
    const py = PIECE_SIZE * 0.42;
    for (let i = 0; i < piece.size; i++) {
      pips.appendChild(el('circle', { cx: px, cy: py - i * 6, r: 2.4, class: 'piece-pip' }));
    }
    group.appendChild(pips);

    return group;
  }

  function render(doc) {
    pieces.replaceChildren();
    for (const piece of Object.values(doc.pieces)) {
      pieces.appendChild(renderPiece(piece));
    }
  }

  return { svg, render };
}
