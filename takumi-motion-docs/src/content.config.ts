import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // Diátaxis page type — required on every page per docs/AGENTS.md.
      extend: z.object({
        type: z.enum(['tutorial', 'how-to', 'reference', 'explanation']).optional(),
      }),
    }),
  }),
};
