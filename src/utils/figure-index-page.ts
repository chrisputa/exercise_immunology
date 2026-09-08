/**
 * Composition layer for the auto-generated figure index.
 *
 * Keeps the two routes that need it — the listing page and the lecture route
 * that renders it — reading from one source, so the page cannot be built
 * without a matching link, or vice versa.
 *
 * `utils/figure-index` stays a pure parser; the Astro-specific parts (reading
 * the collection, honouring `draft`, deriving display names from the same
 * grouping the listing uses) live here.
 */

import { getCollection, getEntry } from 'astro:content';
import { groupEntries } from './collection-groups';
import { extractFigures, type ExtractedFigure } from './figure-index';

export type FigureIndexConfig = {
    slug: string;
    title: string;
    description?: string;
};

export type FigureIndexSection = {
    lectureId: string;
    /** The lecture's own title. */
    title: string;
    /** Its position in the listing, e.g. "Lecture 4" or "Metabolic 2". */
    displayName: string;
    figures: ExtractedFigure[];
};

/** Resolved config, or null when the figure index is switched off. */
export async function getFigureIndexConfig(): Promise<FigureIndexConfig | null> {
    const preamble = await getEntry('pages', 'lectures');
    const config = preamble?.data?.figureIndex;

    if (!config?.enabled) return null;

    return { slug: config.slug, title: config.title, description: config.description };
}

/**
 * Every non-draft lecture that actually contains figures, in listing order.
 *
 * Drafts are filtered here rather than in the parser so the index follows the
 * same visibility rule as the listing page: a lecture nobody can reach should
 * not leak its figures through the index.
 */
export async function getFigureIndexSections(): Promise<FigureIndexSection[]> {
    const lectures = (await getCollection('lectures')).filter((lecture) => !lecture.data.draft);
    const preamble = await getEntry('pages', 'lectures');

    // Reuse the listing's own grouping so "Lecture 4" here means the same
    // lecture it means over there, subcategories and all.
    const groups = groupEntries(lectures, preamble?.data?.subcategories, { defaultLabel: 'Lecture' });

    return groups
        .flatMap((group) =>
            group.entries.map((lecture, i) => ({
                lectureId: lecture.id,
                title: lecture.data.title,
                displayName: `${group.label} ${i + 1}`,
                figures: extractFigures(lecture.id)
            }))
        )
        .filter((section) => section.figures.length > 0);
}

/** "Lecture 4 · Figure 2", collapsing to a range when the figure has panels. */
export function figureLabel(displayName: string, figure: ExtractedFigure): string {
    const { startNum, endNum } = figure;

    const number =
        endNum === startNum
            ? `Figure ${startNum}`
            : endNum === startNum + 1
              ? `Figure ${startNum} & ${endNum}`
              : `Figure ${startNum}–${endNum}`;

    return `${displayName} · ${number}`;
}
