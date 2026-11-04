// Run with:  npx tsx --test lib/client-boundary.test.ts
//
// Server code must never read a VALUE from a "use client" module: on the server everything such a
// module exports is an opaque client reference; only a component can be passed on (rendered as
// <Comp />). Reading a constant, calling a helper or "dotting" into it fails at run time with
// "Cannot access X on the server ...". This scans the whole app:
// - lib/** and "use server" files: no import from a "use client" module at all;
// - every other file that is not itself "use client" (pages, layouts, routes, shared modules):
//   only components (Capitalised names) from a "use client" module, never `Comp.something`,
//   never `import * as`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", ".git"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    if (SKIP.has(f)) return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f) ? [p] : [];
  });
}

// the first statement of the file (after comments) is the directive
function directive(src: string): "client" | "server" | null {
  const body = src.replace(/^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, "");
  const m = /^["']use (client|server)["']/.exec(body);
  return m ? (m[1] as "client" | "server") : null;
}

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null; // a package
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

interface Imp {
  spec: string;
  names: string[]; // local names of value imports (not "import type")
  star: string | null;
  typeOnly: boolean;
}
function imports(src: string): Imp[] {
  const out: Imp[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const typeOnly = !!m[1];
    const clause = m[2];
    const star = /\*\s+as\s+(\w+)/.exec(clause)?.[1] ?? null;
    const names: string[] = [];
    const def = /^(\w+)\s*(,|$)/.exec(clause.trim())?.[1];
    if (def && def !== "type") names.push(def);
    const braces = /\{([\s\S]*?)\}/.exec(clause)?.[1];
    if (braces)
      for (const part of braces.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (part.startsWith("type ")) continue;
        names.push(part.split(/\s+as\s+/).pop()!.trim());
      }
    out.push({ spec: m[3], names, star, typeOnly });
  }
  // dynamic import("./x") from server code is checked too
  for (const d of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: d[1], names: ["<dynamic import>"], star: null, typeOnly: false });
  return out;
}

const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "lib")), join(ROOT, "middleware.ts")].filter((f) => existsSync(f));
const kind = new Map(files.map((f) => [f, directive(readFileSync(f, "utf8"))]));

export function boundaryProblems(): string[] {
  const problems: string[] = [];
  for (const f of files) {
    if (kind.get(f) === "client") continue; // a client module may import other client modules
    if (/\.test\.ts$/.test(f) || /[\\/]testing[\\/]/.test(f)) continue;
    const src = readFileSync(f, "utf8");
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    const strict = rel.startsWith("lib/") || kind.get(f) === "server";
    for (const imp of imports(src)) {
      if (imp.typeOnly) continue;
      const target = resolve(f, imp.spec);
      if (!target || kind.get(target) !== "client") continue;
      const where = `${rel} imports from "use client" ${relative(ROOT, target).replace(/\\/g, "/")}`;
      if (strict) {
        if (imp.names.length || imp.star) problems.push(`${where}: ${rel.startsWith("lib/") ? "lib/" : '"use server"'} code must not import from a client module`);
        continue;
      }
      if (imp.star) problems.push(`${where}: import * as ${imp.star} (a namespace of client references)`);
      for (const n of imp.names) {
        if (n === "<dynamic import>") problems.push(`${where}: dynamic import of a client module from server code`);
        else if (!/^[A-Z]/.test(n) || /^[A-Z0-9_]+$/.test(n)) problems.push(`${where}: "${n}" is not a component (a value read on the server fails)`);
        else if (new RegExp(`\\b${n}\\.\\w`).test(src)) problems.push(`${where}: "${n}.something" reads into a client reference`);
      }
    }
  }
  return problems;
}

test("no server file reads a value from a \"use client\" module (only components are passed on)", () => {
  assert.ok(files.length > 100, `scanned ${files.length} files`);
  assert.ok([...kind.values()].filter((k) => k === "client").length > 10, "client modules found");
  assert.deepEqual(boundaryProblems(), []);
});

test("the check itself catches the mistakes it is meant to catch", () => {
  const fake = (clause: string) => imports(`import ${clause} from "./x";`)[0];
  assert.deepEqual(fake("{ PROSE, SopEditor }").names, ["PROSE", "SopEditor"]);
  assert.deepEqual(fake("{ type Doc, Thing as Other }").names, ["Other"]);
  assert.equal(fake("* as ui").star, "ui");
  assert.equal(imports(`import type { A } from "./x";`)[0].typeOnly, true);
  assert.equal(directive(`// comment\n/* more */\n"use client";\nexport const A = 1;`), "client");
  assert.equal(directive(`import x from "y";\n"use client";`), null, "only as the first statement");
});
