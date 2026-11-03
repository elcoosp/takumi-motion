// takumi-motion — react/ts-worker-loader.mjs (v1.0)
//
// A minimal, dependency-light TypeScript + JSX ESM loader for WORKER THREADS
// (and the CLI's fallback path). Why not tsx? tsx ≥4.21 ignores the tsconfig
// `jsx: "react-jsx"` setting for register()-installed hooks — banner modules
// authored with the automatic JSX runtime crash with "React is not defined"
// (the repo's own examples/react-banner.tsx hits this). esbuild — already in
// the tree as tsx's engine — handles the transform correctly when handed the
// tsconfig explicitly, so this loader does exactly that and nothing else:
//
//   resolve: "./x.js" → "./x.ts"/"./x.tsx" (TS-style imports), then default
//   load:    .ts/.tsx/.mts/.jsx → esbuild transform (automatic JSX) → ESM
//
// Plain JS, zero loader-bootstrap needed: spawned with
//   node --import <this-file> worker-entry.ts
// from any package that has esbuild resolvable (it is — tsx depends on it).

import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);

let transform;
try {
  // esbuild ships with tsx (our dependency) — resolvable from this package
  // even when hoisted into the consumer's node_modules root.
  const esbuild = requireFromHere("esbuild");
  transform = esbuild.transformSync;
} catch (error) {
  throw new Error(
    `takumi-motion worker loader: esbuild is not resolvable (${error?.message ?? error}). ` +
    `It ships with the tsx dependency — reinstall dependencies.`,
  );
}

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".jsx"]);
const TRANSFORM_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".jsx"]);

function tsconfigRawFor(file) {
  // Walk up from the file for the nearest tsconfig.json; hand esbuild the raw
  // compilerOptions it understands (jsx, target, experimentalDecorators…).
  let dir = dirname(file);
  for (;;) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(
          readFileSync(candidate, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g, ""),
        );
        const co = parsed.compilerOptions ?? {};
        const jsx = typeof co.jsx === "string" && co.jsx.startsWith("react-jsx") ? "automatic" : undefined;
        return {
          jsx,
          jsxImportSource: co.jsxImportSource ?? "react",
          target: typeof co.target === "string" && co.target !== "esnext" ? co.target : "es2022",
          experimentalDecorators: co.experimentalDecorators === true,
          useDefineForClassFields: co.useDefineForClassFields,
          verbatimModuleSyntax: co.verbatimModuleSyntax === true,
        };
      } catch {
        // malformed tsconfig — transform with defaults
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return { jsx: "automatic", jsxImportSource: "react", target: "es2022" };
    dir = parent;
  }
}

function toEsmFormat(file) {
  const ext = extname(file);
  if (ext === ".mts" || ext === ".mjs") return "module";
  if (ext === ".cts" || ext === ".cjs") return "commonjs";
  // .ts/.tsx inside a "type": "module" package scope → ESM; the nearest
  // package.json decides (walk up like node does).
  let dir = dirname(file);
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8"));
        if (pkg.type === "module") return "module";
        if (pkg.type === "commonjs") return "commonjs";
        break; // explicit neither → node default (commonjs for .js, module for .mjs)
      } catch {
        break;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return ext === ".ts" || ext === ".tsx" ? "module" : "commonjs";
}

const resolveHook = {
  resolve(specifier, context, nextResolve) {
    // TS-style imports: "./x.js" when only "./x.ts" exists. Try the literal
    // specifier first (cheap), then the TS candidates.
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!context.parentURL || !context.parentURL.startsWith("file:")) throw error;
      if (!specifier.startsWith(".") && !specifier.startsWith("#")) throw error;
      if (!/\.[cm]?js$/.test(specifier)) throw error;
      const parent = fileURLToPath(context.parentURL.split("?")[0]);
      const base = specifier.endsWith(".js") ? specifier.slice(0, -3) : specifier.slice(0, -4);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${join(dirname(specifier), "index.ts")}`]) {
        // candidates are relative to the parent module's directory
        const resolved = join(dirname(parent), candidate);
        if (existsSync(resolved)) {
          return nextResolve(pathToFileURL(resolved).href, context);
        }
      }
      throw error;
    }
  },
};

const loadHook = {
  load(url, context, nextLoad) {
    if (!url.startsWith("file:")) return nextLoad(url, context);
    const path = fileURLToPath(url.split("?")[0]);
    const ext = extname(path).toLowerCase();
    if (!TRANSFORM_EXTENSIONS.has(ext)) return nextLoad(url, context);
    if (ext === ".mts" && false) return nextLoad(url, context); // (never — keep .mts transformed)
    let source;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      return nextLoad(url, context);
    }
    const raw = tsconfigRawFor(path);
    const result = transform(source, {
      loader: ext === ".tsx" || ext === ".jsx" ? "tsx" : "ts",
      format: toEsmFormat(path) === "commonjs" ? "cjs" : "esm",
      sourcefile: path,
      sourcemap: "inline",
      target: "es2022",
      jsx: raw.jsx,
      jsxImportSource: raw.jsxImportSource,
      tsconfigRaw: { compilerOptions: raw },
    });
    // .ts under a CJS scope runs through node's CJS loader (format commonjs);
    // esbuild's cjs output keeps require/exports semantics intact.
    return { format: toEsmFormat(path), source: result.code, shortCircuit: true };
  },
};

// registration happens at --import time, before the worker entry loads.
// registerHooks (Node ≥ 22.15) installs the hooks synchronously in THIS
// thread — no specifier dance needed for a self-contained loader file.
registerHooks(loadHook);
registerHooks(resolveHook);
