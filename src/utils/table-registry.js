// src/utils/table-registry.js
// Per-page table numbering, independent from figures. Mirrors
// figure-registry.js: module state is reset once per page render via
// resetTableRegistry() in BaseLayout, so every lecture's tables count from 1.
// Only captioned tables (wrapped in <Table>) consume a number; plain markdown
// tables stay unnumbered.
let counter = 1;

export function getNextTableNumber() {
    return counter++;
}

export function resetTableRegistry() {
    counter = 1;
}
