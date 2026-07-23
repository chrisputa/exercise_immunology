import {glob} from 'astro/loaders';
import {defineCollection, z} from 'astro:content';

const seoSchema = z.object({
    title: z.string().min(5).max(120).optional(),
    description: z.string().min(15).max(160).optional(),
    image: z
        .object({
            src: z.string(),
            alt: z.string().optional()
        })
        .optional(),
    pageType: z.enum(['website', 'article']).default('website')
});

// Optional grouping of a listing page into named subcategories. `label` doubles
// as the folder prefix (unless `prefix` overrides it) and as the word before the
// running number: label "Metabolic" matches `metabolic-1/` and renders
// "Metabolic 1". Omit the field entirely for a flat, ungrouped listing.
const subcategorySchema = z.object({
    title: z.string(),
    label: z.string(),
    prefix: z.string().optional(),
    description: z.string().optional()
});

const pages = defineCollection({
    loader: glob({pattern: '**/*.{md,mdx}', base: './src/content/pages'}),
    schema: z.object({
        title: z.string(),
        seo: seoSchema.optional(),
        showHeader: z.boolean().default(false),
        subcategories: z.array(subcategorySchema).optional(),
        // Optional iframe embed: when set, the page is rendered with DashboardLayout
        // instead of PageLayout (see src/pages/[...id].astro).
        iframeSrc: z.string().optional(),
        iframeWidth: z.number().optional(),
        iframeHeight: z.number().optional(),
        iframeScale: z.number().optional(),
    })
});

const dashboards = defineCollection({
    loader: glob({pattern: '**/*.{md,mdx}', base: './src/content/dashboards'}),
    schema: z.object({
        title: z.string(),
        description: z.string().optional(),
        publishDate: z.coerce.date(),
        draft: z.boolean().optional(),
        iframeSrc: z.string().optional(),
        iframeWidth: z.number().optional(),
        iframeHeight: z.number().optional(),
        iframeScale: z.number().optional(),
        seo: seoSchema.optional()
    })
});

const tutorials = defineCollection({
    loader: glob({pattern: '**/index.{md,mdx}', base: './src/content/tutorials'}),
    schema: z.object({
        title: z.string(),
        description: z.string().optional(),
        publishDate: z.coerce.date(),
        draft: z.boolean().optional(),
        seo: seoSchema.optional()
    })
});

const tutorialSlides = defineCollection({
  loader: glob({ pattern: '**/slides/*.{md,mdx}', base: './src/content/tutorials' }),
  schema: z.object({
    title: z.string().optional(),
    order: z.number().optional(),
    draft: z.boolean().optional(),
    hidden: z.boolean().optional(),
    seo: seoSchema.optional(),
  }),
});

const exam = defineCollection({
    loader: glob({pattern: '**/*.{md,mdx}', base: './src/content/exam'}),
    schema: z.object({
        title: z.string(),
        sequence: z.number(),
        draft: z.boolean().optional(),
        description: z.string().optional(),
        publishDate: z.coerce.date(),
        tags: z.array(z.string()).default([]),
        seo: seoSchema.optional()
    })
});

const lectures = defineCollection({
  loader: glob({ pattern: '**/index.{md,mdx}', base: './src/content/lectures' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    draft: z.boolean().optional(),
    examRelevant: z.boolean().default(false),
    // Overrides the folder-prefix grouping, so a lecture can be moved into a
    // subcategory without renaming its folder (and thus changing its URL).
    category: z.string().optional(),
    seo: seoSchema.optional(),
  }),
});

const slides = defineCollection({
  loader: glob({ pattern: '**/slides/*.{md,mdx}', base: './src/content/lectures' }),
  schema: z.object({
    title: z.string().optional(),
    order: z.number().optional(),
        // Mark a slide as a draft (included only in dev unless overridden in route logic)
        draft: z.boolean().optional(),
        // Force exclude a slide even in production builds (unless explicitly enabled in route logic)
        hidden: z.boolean().optional(),
    seo: seoSchema.optional(),
  }),
});

export const collections = { slides, tutorialSlides, pages, lectures, dashboards, tutorials , exam};
