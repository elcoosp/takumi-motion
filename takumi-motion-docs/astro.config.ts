import { defineDocsConfig } from '@elcoosp/docs-toolkit/config';
import linksValidator from 'starlight-links-validator';
import imageZoom from 'starlight-image-zoom';
import headingBadges from 'starlight-heading-badges';


export default await defineDocsConfig({
  site: 'https://takumi-motion.vercel.app',
  domain: 'takumi-motion.vercel.app',
  title: "Takumi Motion",
  description: "Deterministic server-side animation engine: any React component or raw HTML string becomes a GIF, WebP, APNG, PNG sequence, sprite sheet, or still — rendered by the Rust takumi engine, byte-identical on every run.",
  sidebar: [],
  extraStarlight: {
      expressiveCode: {
      	themes: ['github-light', 'github-dark']
      },
      title: 'Takumi Motion',
      description:
        'Deterministic server-side animation engine: any React component or raw HTML string becomes a GIF, WebP, APNG, PNG sequence, sprite sheet, or still — rendered by the Rust takumi engine, byte-identical on every run.',
      favicon: '/favicon.png',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/elcoosp/takumi-motion' },
      ],
      editLink: {
        baseUrl: 'https://github.com/elcoosp/takumi-motion/edit/main/'
      },
      // Zero-config, index-at-build search. Kept per ADR 0003 (no DocSearch app).
      // pagefind is enabled by default; the key below documents the decision.
      pagefind: true,
      plugins: [linksValidator(), imageZoom(), headingBadges()],
      // Multilingual-ready: the default locale is served from the site root
      // (Starlight's documented `root` locale pattern). Add further locales as
      // sibling keys plus `src/content/docs/<locale>/` folders — no other change.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' }
      },
      lastUpdated: true,
      sidebar: [
        {
          label: 'Tutorials',
          items: [
            { label: 'Your First Banner', slug: 'tutorials/first-banner' },
            { label: 'Declarative Banners', slug: 'tutorials/declarative-banners' },
          ]
        },
        {
          label: 'How-to Guides',
          items: [
            { label: 'Data-Driven Animations', slug: 'guides/data-driven-animations' },
            { label: 'Seamless Loops', slug: 'guides/seamless-loops' },
            { label: 'CI Quality Gates', slug: 'guides/ci-quality-gates' },
            { label: 'Reduce File Size', slug: 'guides/reduce-file-size' },
            { label: 'Render Raw HTML', slug: 'guides/render-from-raw-html' },
            { label: 'Parallel Capture', slug: 'guides/parallel-capture' },
            { label: 'Preview and Inspect', slug: 'guides/preview-and-inspect' },
          ]
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'React Components', slug: 'reference/react-components' },
            { label: 'Hooks & Motion Math', slug: 'reference/hooks' },
            { label: 'Core Engine API', slug: 'reference/core-engine' },
            { label: 'Renderers & Reports', slug: 'reference/renderers' },
            { label: 'Presets, Themes & Fonts', slug: 'reference/presets-and-themes' },
            { label: 'Lint Codes', slug: 'reference/lint-codes' },
            { label: 'Package Exports', slug: 'reference/package-exports' },
          ]
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Architecture', slug: 'explanation/architecture' },
            { label: 'Determinism', slug: 'explanation/determinism' },
            { label: 'Performance & Size', slug: 'explanation/performance-and-size' },
          ]
        },
      ]
    },
});
