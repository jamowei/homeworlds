// app.js — wiring for the shared board page.
//
// Ticket 01: load a deterministic document and paint it. Later tickets extend
// this file with input handling, transports, storage and presence.

import { createDocument } from './core/state.js';
import { createRenderer } from './render/svg.js';

const svg = document.getElementById('board');
const renderer = createRenderer(svg);

let doc = createDocument('local');

renderer.render(doc);
