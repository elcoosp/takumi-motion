#!/usr/bin/env node
// Generates public/llms.txt and public/llms-full.txt for AI-agent discoverability.
// Runs automatically before `pnpm build` (see "prebuild" in package.json).
//
// URLs are site-root-relative (/tutorials/first-banner/) so the files stay
// correct on any deploy origin. See docs/decisions/0006-llms-txt.md.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)); // docs-site/scripts
const siteRoot = dirname(root);
const docsDir = join(siteRoot, "src", "content", "docs");
const publicDir = join(siteRoot, "public");
mkdirSync(publicDir, { recursive: true });

const SITE_TITLE = "Takumi Motion";
const SITE_DESCRIPTION =
  "Deterministic server-side animation engine: React or HTML -> GIF/WebP/APNG/PNG-sequence/sprite-sheet/still, rendered by the Rust takumi engine.";

const SECTIONS = [
  { key: "tutorials", title: "Tutorials", desc: "Guided walkthroughs for first-time users." },
  { key: "guides", title: "How-to Guides", desc: "Task-oriented recipes for specific goals." },
  { key: "reference", title: "Reference", desc: "API surface: CLI, components, hooks, engine, renderers, lint codes." },
  { key: "explanation", title: "Concepts", desc: "Architecture, determinism, performance, and size doctrine." },
];

function readPage(dir, file) {
  const path = join(dir, file);
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const fm = m[1];
  const get = (k) => {
    const km = fm.match(new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m"));
    return km ? km[1].replace(/^"|"$/g, "") : "";
  };
  const title = get("title");
  const description = get("description");
  if (!title) return null;
  const slug = file.replace(/\.mdx?$/, "");
  const url = `/${dir === docsDir ? "" : `${relative(docsDir, dir)}/`}${slug === "index" ? "" : slug}`.replace(/\/+$/, "/");
  return { title, description, url, body: raw.slice(m[0].length).trim(), path: relative(siteRoot, path) };
}

const lines = [
  `# ${SITE_TITLE}`,
  "",
  `> ${SITE_DESCRIPTION}`,
  "",
  "Documentation built with Astro Starlight, structured after the Diátaxis framework.",
  "",
];

const fullLines = [`# ${SITE_TITLE} — full documentation`, "", `> ${SITE_DESCRIPTION}`, ""];

for (const section of SECTIONS) {
  const dir = join(docsDir, section.key);
  let pages;
  try {
    pages = readdirSync(dir)
      .filter((f) => /\.(md|mdx)$/.test(f))
      .map((f) => readPage(dir, f))
      .filter(Boolean);
  } catch {
    continue;
  }
  lines.push(`## ${section.title}`, "", section.desc, "");
  fullLines.push(`## ${section.title}`, "", section.desc, "");
  for (const p of pages) {
    lines.push(`- [${p.title}](${p.url}): ${p.description}`);
    fullLines.push(`### ${p.title}`, `Source: ${p.url}`, "", p.body, "");
  }
  lines.push("");
  fullLines.push("");
}

// Landing page
const landing = readPage(docsDir, "index.mdx");
if (landing) {
  lines.push("## Home", "", `- [Overview](${landing.url}): ${landing.description}`, "");
  fullLines.push(`## Home (${landing.url})`, "", landing.body, "");
}

writeFileSync(join(publicDir, "llms.txt"), lines.join("\n"));
writeFileSync(join(publicDir, "llms-full.txt"), fullLines.join("\n"));
console.log(
  `llms.txt (${lines.length} lines) and llms-full.txt (${fullLines.length} lines) written to public/`,
);
