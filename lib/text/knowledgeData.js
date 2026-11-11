// Isomorphic loader for the knowledge data files (lib/occupations/data/*.json, lib/text/data/*.json).
//
// The knowledge modules are imported by code that also runs in the BROWSER (the résumé engine reaches the statement
// judge), so nothing here may import a Node built-in statically or name a data file in a way a bundler follows
// (`new URL('./data/x.json', import.meta.url)` would emit every file as a client asset). Instead:
//   - Node built-ins are fetched at call time with process.getBuiltinModule (Node ≥ 20.16 / 22.3; Vercel runs 22.x),
//   - the path is assembled at runtime from process.cwd() (a Vercel function's cwd is the project root, where
//     `includeFiles` puts the data) and, failing that, from this module's own file URL,
//   - a server bootstrap may inject data instead (setKnowledgeData) — the fallback for a runtime without
//     getBuiltinModule; nothing in the repo needs it today.
// In the browser every load answers null and the modules degrade to "no knowledge". On the server a failed load is
// reported once per file with console.error, then the same null.

/** @type {Map<string, any>} */
const injected = new Map();
/** @type {Set<string>} */
const reported = new Set();

/** @param {string} name @returns {any} */
function builtin(name) {
  try {
    const p = typeof process !== 'undefined' ? process : null;
    return p && typeof p.getBuiltinModule === 'function' ? p.getBuiltinModule(name) : null;
  } catch { return null; }
}

/**
 * Provide a data file's parsed JSON directly (server bootstrap on a runtime without process.getBuiltinModule).
 * @param {string} file e.g. "lib/occupations/data/titles.json"
 * @param {any} json
 */
export function setKnowledgeData(file, json) { injected.set(file, json); }

/** True where data files can be read (Node), false in a browser bundle. */
export function canLoadKnowledge() { return !!builtin('node:fs'); }

/**
 * Read one data file: `dir` is its repo-relative folder ("lib/occupations/data"), `name` the file name,
 * `metaUrl` the caller's import.meta.url (second place to look). Null when unavailable.
 * @param {string} dir @param {string} name @param {string} [metaUrl]
 * @returns {any | null}
 */
export function loadKnowledge(dir, name, metaUrl) {
  const key = `${dir}/${name}`;
  if (injected.has(key)) return injected.get(key);
  const fs = builtin('node:fs');
  const path = builtin('node:path');
  if (!fs || !path) return null;                       // browser: no knowledge, no error
  const url = builtin('node:url');
  const tried = [];
  const candidates = [path.join(process.cwd(), dir, name)];
  try {
    if (url && metaUrl && String(metaUrl).startsWith('file:')) candidates.push(path.join(path.dirname(url.fileURLToPath(String(metaUrl))), 'data', name));
  } catch { /* not a file URL (bundled) */ }
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { tried.push(p); }
  }
  if (!reported.has(key)) {
    reported.add(key);
    console.error(`[knowledge] could not read ${key} (tried ${tried.join(', ')}); answering without it`);
  }
  return null;
}
