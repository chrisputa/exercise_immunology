// src/utils/figure-registry.js
// Per-page figure numbering. Mirrors margin-note-registry.js: module state is
// reset once per page render via resetFigureRegistry() in BaseLayout, so every
// lecture starts counting at 1. Every <Figure> increments (so physical figure
// order is preserved even when a figure has no caption); the visible label is
// only rendered for figures that actually carry a caption.
let counter = 1;

export function getNextFigureNumber() {
    return counter++;
}

export function resetFigureRegistry() {
    counter = 1;
}
