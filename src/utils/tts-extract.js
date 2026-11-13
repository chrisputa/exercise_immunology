// @ts-check
// Read-aloud text extraction, shared by the audio generator (Node, on the built
// HTML via linkedom — scripts/tts/build-audio.mjs) and the ReadAloud player in
// the browser. Both must find exactly the same blocks: the generator stores a
// fingerprint of the block texts plus, per sentence, the index of its block,
// and the player uses those indices to highlight what is being read. So this
// module only uses plain DOM APIs that both environments implement identically
// and nothing layout-dependent (no getComputedStyle).
//
// Rules: tables, code blocks, KaTeX formulas, images, iframes, form controls,
// margin-note reference numbers and anything marked `data-tts-skip` (or
// `hidden` / `aria-hidden="true"`) are skipped, as are whole sections under
// the headings listed in `skipSections` (tts.config.json). A <figure>
// contributes only its caption, prefixed with its label ("Figure 3: …");
// figures wrapping a table (Table.astro) are skipped entirely.

const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'SECTION', 'SUMMARY', 'UL'
]);
const SKIP_TAGS = new Set([
    'AUDIO', 'BUTTON', 'CANVAS', 'HR', 'IFRAME', 'IMG', 'INPUT', 'MATH', 'NOSCRIPT',
    'OBJECT', 'PICTURE', 'PRE', 'SCRIPT', 'SELECT', 'STYLE', 'SVG', 'TABLE', 'TEMPLATE',
    'TEXTAREA', 'VIDEO'
]);
const HEADING = /^H[1-6]$/;
const ELEMENT = 1;
const TEXT = 3;

/**
 * @typedef {{ text: string, el: Element, kind: 'heading' | 'figure' | 'text' }} Block
 */

/** @param {Element} el */
const tagOf = (el) => el.tagName.toUpperCase();

/** @param {string} s */
const normalize = (s) => s.replace(/\s+/g, ' ').trim();

/** @param {Element} el */
function classes(el) {
    return (el.getAttribute('class') || '').split(/\s+/);
}

// Margin-note and footnote reference numbers ("¹") read as noise mid-sentence.
/** @param {Element} el */
function isRefMarker(el) {
    if (tagOf(el) !== 'SUP') return false;
    if ((el.getAttribute('id') || '').startsWith('ref-')) return true;
    return !!el.querySelector('a[href^="#marginnote-"], a[data-footnote-ref]');
}

/** @param {Element} el */
function shouldSkip(el) {
    if (SKIP_TAGS.has(tagOf(el))) return true;
    if (el.hasAttribute('data-tts-skip') || el.hasAttribute('hidden')) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const cls = classes(el);
    if (cls.includes('katex') || cls.includes('katex-display')) return true;
    return isRefMarker(el);
}

/**
 * Flat text of an element under the same skip rules.
 * @param {Element} root
 */
function plainText(root) {
    let out = '';
    /** @param {Node} node */
    const walk = (node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === TEXT) {
                out += child.textContent;
            } else if (child.nodeType === ELEMENT) {
                const el = /** @type {Element} */ (child);
                if (tagOf(el) === 'BR' || shouldSkip(el)) {
                    out += ' ';
                    continue;
                }
                const block = BLOCK_TAGS.has(tagOf(el));
                if (block) out += ' ';
                walk(el);
                if (block) out += ' ';
            }
        }
    };
    walk(root);
    return normalize(out);
}

/** @param {Element} fig */
function captionsOf(fig) {
    return Array.from(fig.querySelectorAll('figcaption')).filter((c) => !c.closest('[data-tts-skip]'));
}

/**
 * Figure.astro and friends render the caption twice (side margin on desktop,
 * below the image on mobile) and CSS hides one — so the text comes from the
 * first caption, and the player picks the visible one to highlight.
 * @param {Element} fig
 * @returns {Block | null}
 */
function figureBlock(fig) {
    if (fig.querySelector('table, pre')) return null;
    const caption = captionsOf(fig)[0];
    if (!caption) return null;
    const text = plainText(caption);
    if (!text) return null;
    const label = caption.getAttribute('data-figlabel');
    return { text: label ? `${label}: ${text}` : text, el: fig, kind: 'figure' };
}

/**
 * Readable blocks of `root` in document order.
 *
 * `skipSections` lists heading texts (case-insensitive, e.g. "References")
 * whose whole section is left out: the heading and everything after it up to
 * the next heading of the same or a higher level.
 * @param {Element} root
 * @param {{ skipSections?: string[] }} [options]
 * @returns {Block[]}
 */
export function extractBlocks(root, options = {}) {
    /** @type {Block[]} */
    const blocks = [];
    let buf = '';
    /** @type {Element | null} */
    let owner = null;
    const skipTitles = new Set((options.skipSections ?? []).map((t) => normalize(t).toLowerCase()));
    /** Level of the heading that opened a skipped section, 0 when not skipping. */
    let skipLevel = 0;

    const flush = () => {
        const text = normalize(buf);
        if (text && owner) {
            const el = blockAncestor(owner, root);
            blocks.push({ text, el, kind: HEADING.test(tagOf(el)) ? 'heading' : 'text' });
        }
        buf = '';
        owner = null;
    };

    /** @param {Element} node */
    const visit = (node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === ELEMENT && HEADING.test(tagOf(/** @type {Element} */ (child)))) {
                const el = /** @type {Element} */ (child);
                const level = Number(tagOf(el)[1]);
                if (skipLevel && level <= skipLevel) skipLevel = 0;
                if (!skipLevel && skipTitles.has(plainText(el).toLowerCase())) {
                    flush();
                    skipLevel = level;
                }
            }
            if (skipLevel) continue;
            if (child.nodeType === TEXT) {
                if (!owner) owner = node;
                buf += child.textContent;
                continue;
            }
            if (child.nodeType !== ELEMENT) continue;
            const el = /** @type {Element} */ (child);
            const tag = tagOf(el);
            if (tag === 'BR') {
                buf += ' ';
                continue;
            }
            if (tag === 'FIGURE') {
                if (shouldSkip(el)) continue;
                flush();
                const block = figureBlock(el);
                if (block) blocks.push(block);
                continue;
            }
            if (shouldSkip(el)) {
                buf += ' ';
                continue;
            }
            if (BLOCK_TAGS.has(tag)) {
                flush();
                visit(el);
                flush();
                continue;
            }
            // Inline element: its text joins the surrounding block.
            if (!owner) owner = node;
            visit(el);
        }
    };

    visit(root);
    flush();
    return blocks;
}

// `owner` is the element whose children were walked, which may be an inline
// wrapper; highlight its nearest block ancestor instead.
/**
 * @param {Element} el
 * @param {Element} root
 */
function blockAncestor(el, root) {
    /** @type {Element | null} */
    let cur = el;
    while (cur && cur !== root) {
        if (BLOCK_TAGS.has(tagOf(cur))) return cur;
        cur = cur.parentElement;
    }
    return el;
}

/**
 * Element to highlight for a block: for figures, the caption that is actually
 * displayed (falls back to the first one outside a browser).
 * @param {Block} block
 */
export function highlightTarget(block) {
    if (block.kind !== 'figure') return block.el;
    const captions = captionsOf(block.el);
    return captions.find((c) => c.getClientRects?.().length > 0) ?? captions[0] ?? block.el;
}

/**
 * Small, fast, dependency-free string hash (cyrb53), hex encoded. Identical in
 * Node and the browser, which is all it is needed for.
 * @param {string} str
 */
export function hashString(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Fingerprint of what the page would read. Audio generated for a different
 * fingerprint is out of date and must not be played.
 * @param {Block[]} blocks
 */
export function blocksFingerprint(blocks) {
    return hashString(blocks.map((b) => b.text).join('\n'));
}
