/**
 * Build-time extraction of every <Figure> in the lecture collection.
 *
 * Figures live in the MDX body as JSX, not in frontmatter, so there is nothing
 * to query: `src` is an import binding that only exists while its own lecture
 * renders. The only way to collect them centrally is to read the MDX source and
 * resolve the import bindings back to the assets they point at — which is what
 * this module does, entirely at build time via `import.meta.glob`.
 *
 * The extracted figures are re-rendered through the real <Figure> component, so
 * image optimisation, dark variants, panel stacking and caption styling stay
 * identical to the originating lecture. Numbering mirrors Figure.astro exactly
 * (every figure reserves one number per image, labels only appear on figures
 * that carry a caption), so a figure keeps the number it has in its lecture.
 *
 * Parsing is deliberately strict: an unparseable <Figure> throws rather than
 * being silently dropped, so an unusual authoring style surfaces as a build
 * error instead of a figure quietly missing from the index.
 */

import type { ImageMetadata } from 'astro';

const sources = import.meta.glob<string>('/src/content/lectures/*/index.mdx', {
    query: '?raw',
    import: 'default',
    eager: true
});

const assets = import.meta.glob<ImageMetadata>('/src/assets/**/*.{png,jpg,jpeg,gif,webp,avif,svg}', {
    import: 'default',
    eager: true
});

export type FigurePanel = {
    src: ImageMetadata;
    srcDark?: ImageMetadata;
    alt?: string;
};

export type ExtractedFigure = {
    src: ImageMetadata;
    srcDark?: ImageMetadata;
    alt?: string;
    panels: FigurePanel[];
    margin: boolean;
    /** Raw caption markdown; empty when the figure carries no caption. */
    caption: string;
    /** Figure number as it appears in the originating lecture. */
    startNum: number;
    /** Equals startNum unless the figure has panels, which each take a number. */
    endNum: number;
};

/* -------------------------------------------------------------------------- */
/* JSX scanning                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Walks forward from `start` to the matching close of a `{...}` or `[...]`
 * expression, skipping over anything inside string literals. Returns the index
 * just past the closing bracket.
 */
function skipExpression(source: string, start: number): number {
    const depth: string[] = [];
    let quote: string | null = null;

    for (let i = start; i < source.length; i++) {
        const char = source[i];

        if (quote) {
            if (char === '\\') i++;
            else if (char === quote) quote = null;
            continue;
        }

        if (char === '"' || char === "'" || char === '`') {
            quote = char;
        } else if (char === '{' || char === '[' || char === '(') {
            depth.push(char);
        } else if (char === '}' || char === ']' || char === ')') {
            depth.pop();
            if (depth.length === 0) return i + 1;
        }
    }

    throw new Error('figure-index: unterminated JSX expression');
}

type RawAttrs = Record<string, { value: string; isExpr: boolean }>;

/**
 * Parses the attributes of an opening tag starting at `start` (the index just
 * past `<Figure`). Returns the attributes and the index just past the `>`.
 */
function parseOpeningTag(source: string, start: number): { attrs: RawAttrs; end: number } {
    const attrs: RawAttrs = {};
    let i = start;

    while (i < source.length) {
        while (i < source.length && /\s/.test(source[i])) i++;

        if (source[i] === '>') return { attrs, end: i + 1 };
        if (source.startsWith('/>', i)) return { attrs, end: i + 2 };

        const nameMatch = /^[A-Za-z_][\w-]*/.exec(source.slice(i));
        if (!nameMatch) throw new Error(`figure-index: cannot parse attribute at "${source.slice(i, i + 40)}"`);

        const name = nameMatch[0];
        i += name.length;

        while (i < source.length && /\s/.test(source[i])) i++;

        // A bare attribute is shorthand for `={true}`, e.g. `margin`.
        if (source[i] !== '=') {
            attrs[name] = { value: 'true', isExpr: true };
            continue;
        }

        i++;
        while (i < source.length && /\s/.test(source[i])) i++;

        if (source[i] === '{') {
            const end = skipExpression(source, i);
            attrs[name] = { value: source.slice(i + 1, end - 1).trim(), isExpr: true };
            i = end;
        } else if (source[i] === '"' || source[i] === "'") {
            const quote = source[i];
            const end = source.indexOf(quote, i + 1);
            if (end === -1) throw new Error('figure-index: unterminated attribute string');
            attrs[name] = { value: source.slice(i + 1, end), isExpr: false };
            i = end + 1;
        } else {
            throw new Error(`figure-index: unsupported attribute value at "${source.slice(i, i + 40)}"`);
        }
    }

    throw new Error('figure-index: unterminated <Figure> opening tag');
}

/* -------------------------------------------------------------------------- */
/* Import resolution                                                          */
/* -------------------------------------------------------------------------- */

/** Resolves a specifier relative to `dir` into an absolute `/src/...` path. */
function resolveRelative(dir: string, specifier: string): string {
    const segments = dir.split('/').filter(Boolean);

    for (const part of specifier.split('/')) {
        if (part === '.' || part === '') continue;
        else if (part === '..') segments.pop();
        else segments.push(part);
    }

    return `/${segments.join('/')}`;
}

/**
 * Maps every default-import binding in the file to the asset it points at.
 * Non-asset imports (components, helpers) resolve to nothing and are skipped.
 */
function buildImportMap(source: string, dir: string): Map<string, ImageMetadata> {
    const map = new Map<string, ImageMetadata>();
    const pattern = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/gm;

    for (const [, identifier, specifier] of source.matchAll(pattern)) {
        if (!specifier.startsWith('.')) continue;
        const asset = assets[resolveRelative(dir, specifier)];
        if (asset) map.set(identifier, asset);
    }

    return map;
}

/* -------------------------------------------------------------------------- */
/* Figure extraction                                                          */
/* -------------------------------------------------------------------------- */

function lookupImage(imports: Map<string, ImageMetadata>, expr: string, lectureId: string): ImageMetadata {
    const image = imports.get(expr.trim());
    if (!image) {
        throw new Error(
            `figure-index: ${lectureId} uses <Figure src={${expr}}>, which is not a plain image import. ` +
                `The figure index can only resolve figures whose src is imported directly.`
        );
    }
    return image;
}

/** Parses `panels={[{ src: figA, srcDark: figB, alt: '…' }, …]}`. */
function parsePanels(expr: string, imports: Map<string, ImageMetadata>, lectureId: string): FigurePanel[] {
    const panels: FigurePanel[] = [];

    for (const [, body] of expr.matchAll(/\{([^{}]*)\}/g)) {
        const src = /\bsrc\s*:\s*([A-Za-z_$][\w$]*)/.exec(body);
        if (!src) continue;

        const srcDark = /\bsrcDark\s*:\s*([A-Za-z_$][\w$]*)/.exec(body);
        const alt = /\balt\s*:\s*['"]([^'"]*)['"]/.exec(body);

        panels.push({
            src: lookupImage(imports, src[1], lectureId),
            srcDark: srcDark ? lookupImage(imports, srcDark[1], lectureId) : undefined,
            alt: alt?.[1]
        });
    }

    return panels;
}

/**
 * Extracts every <Figure> from one lecture's MDX source, in document order,
 * numbered exactly as Figure.astro would number them.
 */
export function extractFigures(lectureId: string): ExtractedFigure[] {
    const path = `/src/content/lectures/${lectureId}/index.mdx`;
    const source = sources[path];
    if (source === undefined) return [];

    const imports = buildImportMap(source, `/src/content/lectures/${lectureId}`);
    const figures: ExtractedFigure[] = [];
    let counter = 1;
    let cursor = 0;

    while (true) {
        // Match `<Figure` only when followed by whitespace, `>` or `/`, so a
        // component such as <FigureHTML> is not mistaken for one.
        const open = source.slice(cursor).search(/<Figure(?=[\s/>])/);
        if (open === -1) break;

        const tagStart = cursor + open;
        const { attrs, end } = parseOpeningTag(source, tagStart + '<Figure'.length);

        const close = source.indexOf('</Figure>', end);
        const selfClosing = source.slice(tagStart, end).trimEnd().endsWith('/>');
        const caption = selfClosing || close === -1 ? '' : source.slice(end, close).trim();

        if (!attrs.src) throw new Error(`figure-index: <Figure> without src in ${lectureId}`);

        const panels = attrs.panels ? parsePanels(attrs.panels.value, imports, lectureId) : [];

        // Mirror Figure.astro: one number per image, so physical order holds.
        const startNum = counter++;
        counter += panels.length;

        figures.push({
            src: lookupImage(imports, attrs.src.value, lectureId),
            srcDark: attrs.srcDark ? lookupImage(imports, attrs.srcDark.value, lectureId) : undefined,
            alt: attrs.alt?.value,
            panels,
            margin: attrs.margin?.value === 'true',
            caption,
            startNum,
            endNum: counter - 1
        });

        cursor = selfClosing || close === -1 ? end : close + '</Figure>'.length;
    }

    return figures;
}
