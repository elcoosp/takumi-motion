import { defineDocsConfig } from '@elcoosp/docs-toolkit/config';
import imageZoom from 'starlight-image-zoom';
import headingBadges from 'starlight-heading-badges';
export default await defineDocsConfig({
  llmsTxt: {},
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
        { icon: 'github', label: 'GitHub', translations: { fr: "GitHub" }, href: 'https://github.com/elcoosp/takumi-motion' },
      ],
      editLink: {
        baseUrl: 'https://github.com/elcoosp/takumi-motion/edit/main/'
      },
      // Zero-config, index-at-build search. Kept per ADR 0003 (no DocSearch app).
      // pagefind is enabled by default; the key below documents the decision.
      pagefind: true,
      lastUpdated: true,
      sidebar: [
        {
          label: 'Tutorials', translations: { fr: 'Tutoriels' },
          items: [
            { label: 'Your First Banner', translations: { fr: "Votre première bannière" }, slug: 'tutorials/first-banner' },
            { label: 'Declarative Banners', translations: { fr: "Bannières déclaratives" }, slug: 'tutorials/declarative-banners' },
          ]
        },
        {
          label: 'How-to Guides', translations: { fr: 'Guides pratiques' },
          items: [
            { label: 'Data-Driven Animations', translations: { fr: "Animations pilotées par les données" }, slug: 'guides/data-driven-animations' },
            { label: 'Seamless Loops', translations: { fr: "Boucles transparentes" }, slug: 'guides/seamless-loops' },
            { label: 'CI Quality Gates', translations: { fr: "Portes de qualité CI" }, slug: 'guides/ci-quality-gates' },
            { label: 'Reduce File Size', translations: { fr: "Réduire la taille du fichier" }, slug: 'guides/reduce-file-size' },
            { label: 'Render Raw HTML', translations: { fr: "Rendre le HTML brut" }, slug: 'guides/render-from-raw-html' },
            { label: 'Parallel Capture', translations: { fr: "Capture parallèle" }, slug: 'guides/parallel-capture' },
            { label: 'Preview and Inspect', translations: { fr: "Aperçu et inspection" }, slug: 'guides/preview-and-inspect' },
          ]
        },
        {
          label: 'Reference', translations: { fr: 'Référence' },
          items: [
            { label: 'CLI', translations: { fr: "CLI" }, slug: 'reference/cli' },
            { label: 'React Components', translations: { fr: "Composants React" }, slug: 'reference/react-components' },
            { label: 'Hooks & Motion Math', translations: { fr: "Hooks et mathématiques du mouvement" }, slug: 'reference/hooks' },
            { label: 'Core Engine API', translations: { fr: "API du moteur principal" }, slug: 'reference/core-engine' },
            { label: 'Renderers & Reports', translations: { fr: "Moteurs de rendu et rapports" }, slug: 'reference/renderers' },
            { label: 'Presets, translations: { fr: "Préréglages, thèmes et polices" }, Themes & Fonts', slug: 'reference/presets-and-themes' },
            { label: 'Lint Codes', translations: { fr: "Codes de lint" }, slug: 'reference/lint-codes' },
            { label: 'Package Exports', translations: { fr: "Exports du paquet" }, slug: 'reference/package-exports' },
          ]
        },
        {
          label: 'Concepts', translations: { fr: "Concepts" },
          items: [
            { label: 'Architecture', translations: { fr: "Architecture" }, slug: 'explanation/architecture' },
            { label: 'Determinism', translations: { fr: "Déterminisme" }, slug: 'explanation/determinism' },
            { label: 'Performance & Size', translations: { fr: "Performances et taille" }, slug: 'explanation/performance-and-size' },
          ]
        },
      ]
    },
});
