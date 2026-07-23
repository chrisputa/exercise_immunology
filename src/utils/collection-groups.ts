/**
 * Splits a content collection into an optional set of named subcategories.
 *
 * The grouping key is the folder prefix of an entry's id: with a subcategory
 * labelled "Metabolic", the folder `metabolic-1/` joins that group and is
 * numbered "Metabolic 1". Entries matching no subcategory fall into the default
 * group, which carries no heading and keeps the collection's own label
 * ("Lecture 1", "Lecture 2", ...). The default group is always rendered first.
 *
 * Passing no subcategories yields a single default group — i.e. exactly the
 * previous ungrouped behaviour. The feature is opt-in and costs nothing unused.
 *
 * Deliberately free of Astro imports so it can be reused across sites: it only
 * needs entries shaped `{ id, data }`.
 */

export type Subcategory = {
    /** Heading rendered above the group, e.g. "Metabolic backbone lectures". */
    title: string;
    /** Word placed before the running number, e.g. "Metabolic" -> "Metabolic 1". */
    label: string;
    /** Folder prefix, when it should differ from the slugified label. */
    prefix?: string;
    /** Optional intro paragraph shown below the group heading. */
    description?: string;
};

export type EntryGroup<T> = {
    /** Undefined for the default group, which sits under the page's own title. */
    title?: string;
    label: string;
    prefix: string;
    description?: string;
    entries: T[];
};

type GroupableEntry = { id: string; data: Record<string, any> };

const slugify = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-');

/** First number in an id ("lecture-11" -> 11); 0 when the id carries none. */
const numberOf = (id: string) => parseInt(id.match(/\d+/)?.[0] ?? '0', 10);

export function groupEntries<T extends GroupableEntry>(
    entries: T[],
    subcategories: Subcategory[] = [],
    options: { defaultLabel?: string } = {}
): EntryGroup<T>[] {
    const groups: EntryGroup<T>[] = subcategories.map((sub) => ({
        title: sub.title,
        label: sub.label,
        prefix: sub.prefix ?? slugify(sub.label),
        description: sub.description,
        entries: []
    }));

    const fallback: EntryGroup<T> = {
        label: options.defaultLabel ?? 'Lecture',
        prefix: '',
        entries: []
    };

    for (const entry of entries) {
        // An explicit `category` in the entry's own frontmatter wins over the
        // folder name, so an entry can be regrouped without changing its URL.
        const category = entry.data.category;
        const match = category
            ? groups.find((g) => g.prefix === slugify(category) || slugify(g.label) === slugify(category))
            : // Longest prefix wins, so "lecture-special" beats "lecture".
              groups
                  .filter((g) => entry.id.startsWith(`${g.prefix}-`))
                  .sort((a, b) => b.prefix.length - a.prefix.length)[0];

        (match ?? fallback).entries.push(entry);
    }

    return [fallback, ...groups]
        .filter((group) => group.entries.length > 0)
        .map((group) => ({
            ...group,
            entries: [...group.entries].sort((a, b) => numberOf(a.id) - numberOf(b.id))
        }));
}
