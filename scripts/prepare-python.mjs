import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const project = fileURLToPath(new URL('../', import.meta.url));
const upstream = resolve(process.env.PLATO_SOURCE_ROOT || join(project, '..', 'PLATO'));
const target = join(project, 'python', 'plato');
const modules = ['lato_workflow.py', 'llm_client.py', 'lato_assets.py', 'nlp_optional.py', 'plantuml_kb.py', 'plantuml_validator.py', 'settings_loader.py'];
await mkdir(join(target, 'src', 'core'), { recursive: true });
await writeFile(join(target, 'src', '__init__.py'), '');
for (const name of modules) await cp(join(upstream, 'backend/src/core', name), join(target, 'src/core', name));
for (const path of ['src/lato', 'nl2diagram/kb/plantuml']) {
  await cp(join(upstream, 'backend', path), join(target, path), { recursive: true, filter: p => !p.includes('__pycache__') });
}
await cp(join(upstream, 'LICENSE'), join(target, 'LICENSE'));
const hashes = {};
async function walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) await walk(join(dir, entry.name), rel + '/');
    else hashes[rel] = createHash('sha256').update(await readFile(join(dir, entry.name))).digest('hex');
  }
}
await walk(target);
await writeFile(join(project, 'python', 'source-manifest.json'), JSON.stringify({
  upstream: 'https://github.com/Ekay47/PLATO',
  baselineCommit: 'bf36c90fa1ebebe762ebe6046006fa739c153218',
  note: 'Byte-for-byte copies of the current local source; llm_client.py already contained a local mock fix. No algorithm edits by this adapter.',
  files: hashes,
}, null, 2));
console.log(`Prepared ${Object.keys(hashes).length} PLATO source/resource files; no credentials, venv or JAR copied.`);
