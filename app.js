// app.js — wiring for the shared board page.
//
// Tickets so far: 01 paints the initial board, 05 adds the camera (pan, wheel
// zoom, pinch, +/− buttons). Later tickets extend this file with piece input,
// transports, storage and presence.

import { createDocument, applyMessage, buildCameraMessage } from './core/state.js';
import { createRenderer } from './render/svg.js';

const PEER_ID = 'local';

const svg = document.getElementById('board');
let doc = createDocument('local');

const renderer = createRenderer(svg, { onOperation: handleOperation });

function handleOperation(op) {
  switch (op.type) {
    case 'camera': {
      const message = buildCameraMessage(doc, op.camera, PEER_ID);
      doc = applyMessage(doc, message);
      renderer.render(doc);
      break;
    }
    default:
      break;
  }
}

renderer.render(doc);
requestAnimationFrame(() => renderer.measure());

document.getElementById('zoom-in')?.addEventListener('click', () => renderer.zoomBy(1.25));
document.getElementById('zoom-out')?.addEventListener('click', () => renderer.zoomBy(0.8));
