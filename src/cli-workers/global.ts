import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { lstat, mkdir, open, readFile, rename, rm, writeFile, link } from 'node:fs/promises';
import { managedBlockBounds, updateManagedBlock } from '../t3/managed-instructions.ts';
import type { T3Policy } from '../t3/routing.ts';
import { codexWorkerFiles } from './codex.ts';
import { claudeWorkerFiles } from './claude.ts';

const markers = { start: '<!-- switchboard:workers:global:start -->', end: '<!-- switchboard:workers:global:end -->', malformedMessage: 'Malformed global worker instructions; repair the markers before setup' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type Snapshot = { file: string; content: string | null; mode: number };
type Change = Snapshot & { updated: string | null };
type Entry = { file: string; hash: string; owned: boolean };
type Manifest = { version: 1; targets: Entry[]; workers: Entry[] };

async function snapshot(file: string): Promise<Snapshot> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${file}`);
    return { file, content: await readFile(file, 'utf8'), mode: stat.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { file, content: null, mode: 0o600 };
    throw error;
  }
}

async function checkDirectory(dir: string): Promise<void> {
  try {
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${dir}`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

async function paths(policy: T3Policy) {
  const codex = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  const claude = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
  for (const dir of [codex, claude, join(codex, 'agents'), join(claude, 'agents')]) await checkDirectory(dir);
  let override = false;
  try { await lstat(join(codex, 'AGENTS.override.md')); override = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const targets = [join(codex, override ? 'AGENTS.override.md' : 'AGENTS.md'), join(claude, 'CLAUDE.md')];
  const workers = [
    ...codexWorkerFiles(policy).map(file => ({ file: join(codex, 'agents', file.path.split('/').at(-1)!), content: file.content })),
    ...Object.entries(claudeWorkerFiles(policy)).map(([name, content]) => ({ file: join(claude, 'agents', name), content })),
  ];
  return { targets, workers };
}

function parseManifest(content: string | null): Manifest | null {
  if (content === null) return null;
  try {
    const data: unknown = JSON.parse(content);
    if (!data || typeof data !== 'object') throw new Error();
    const m = data as Manifest;
    if (m.version !== 1 || !Array.isArray(m.targets) || !Array.isArray(m.workers) ||
        [...m.targets, ...m.workers].some(e => !e || typeof e.file !== 'string' || typeof e.owned !== 'boolean' || !/^[0-9a-f]{64}$/.test(e.hash))) throw new Error();
    return m;
  } catch { throw new Error('Invalid global worker manifest; inspect it before continuing'); }
}

function block(body: string): string { return `${markers.start}\n${body}\n${markers.end}`; }
function section(content: string | null): string | null {
  const found = managedBlockBounds(content ?? '', markers);
  return found ? content!.slice(found.from, found.to) : null;
}
function validateHomes(manifest: Manifest, targets: string[], workers: string[]): void {
  if (manifest.targets.length !== 2 || manifest.workers.length !== workers.length ||
      manifest.targets.some((e, i) => e.file !== targets[i]) || manifest.workers.some((e, i) => e.file !== workers[i])) {
    throw new Error('Global worker homes or instruction targets changed; restore the original homes and uninstall before changing them');
  }
}

async function commit(root: string, changes: Change[]): Promise<void> {
  const pending = changes.filter(c => c.updated !== c.content);
  const backupRoot = join(root, 'workers-global-backups', randomUUID());
  const staged: Array<{ change: Change; temporary: string }> = [];
  const applied: Change[] = [];
  try {
    for (const [index, c] of pending.entries()) {
      if (c.content !== null) {
        await mkdir(backupRoot, { recursive: true, mode: 0o700 });
        await writeFile(join(backupRoot, `${index}.bak`), c.content, { flag: 'wx', mode: 0o600 });
      }
      if (c.updated === null) continue;
      await mkdir(dirname(c.file), { recursive: true, mode: 0o700 });
      const temporary = `${c.file}.${randomUUID()}.tmp`;
      staged.push({ change: c, temporary });
      const handle = await open(temporary, 'wx', c.mode);
      try { await handle.writeFile(c.updated); await handle.sync(); } finally { await handle.close(); }
    }
    for (const c of pending) {
      if ((await snapshot(c.file)).content !== c.content) throw new Error('Global files changed during setup; retry');
    }
    for (const c of pending) {
      if ((await snapshot(c.file)).content !== c.content) throw new Error('Global files changed during setup; retry');
      if (c.updated === null) await rm(c.file);
      else {
        const temporary = staged.find(item => item.change === c)!.temporary;
        if (c.content === null) await link(temporary, c.file);
        else await rename(temporary, c.file);
      }
      applied.push(c);
    }
  } catch (error) {
    let restored = true;
    for (const c of applied.reverse()) {
      try {
        if ((await snapshot(c.file)).content !== c.updated) { restored = false; continue; }
        if (c.content === null) await rm(c.file, { force: true });
        else {
          const temporary = `${c.file}.${randomUUID()}.restore`;
          try { await writeFile(temporary, c.content, { flag: 'wx', mode: c.mode }); await rename(temporary, c.file); }
          finally { await rm(temporary, { force: true }); }
        }
      } catch { restored = false; }
    }
    if (!restored) throw new Error(`Global setup stopped; inspect files and private backups in ${backupRoot}`);
    throw error;
  } finally { for (const { temporary } of staged) await rm(temporary, { force: true }); }
}

async function locked<T>(root: string, action: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = join(root, 'workers-global.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another global worker setup holds workers-global.lock');
    throw error;
  }
  try { return await action(); } finally { await handle.close(); await rm(file, { force: true }); }
}

export async function installGlobalWorkers(root: string, policy: T3Policy, codexInstructions: string, claudeInstructions: string): Promise<void> {
  await locked(root, async () => {
    const spec = await paths(policy);
    const manifestFile = await snapshot(join(root, 'workers-global.json'));
    const previous = parseManifest(manifestFile.content);
    if (previous) validateHomes(previous, spec.targets, spec.workers.map(w => w.file));
    const changes: Change[] = [];
    const workers: Entry[] = [];
    for (const [i, w] of spec.workers.entries()) {
      const current = await snapshot(w.file);
      if (current.content !== null && current.content !== w.content) throw new Error(`Refusing to overwrite existing worker: ${w.file}`);
      workers.push({ file: w.file, hash: digest(w.content), owned: previous?.workers[i]?.owned ?? current.content === null });
      changes.push({ ...current, updated: w.content });
    }
    const targets: Entry[] = [];
    for (const [i, file] of spec.targets.entries()) {
      const current = await snapshot(file);
      const existing = section(current.content);
      const desired = block(i === 0 ? codexInstructions : claudeInstructions);
      if (existing !== null && previous && digest(existing) !== previous.targets[i]?.hash) throw new Error(`Global worker instruction block was edited: ${file}`);
      if (existing !== null && previous && !previous.targets[i]?.owned && existing !== desired) throw new Error(`Refusing to change an unowned global worker block: ${file}`);
      if (existing !== null && !previous && existing !== desired) throw new Error(`Refusing to overwrite existing global worker block: ${file}`);
      targets.push({ file, hash: digest(desired), owned: previous?.targets[i]?.owned ?? existing === null });
      changes.push({ ...current, updated: updateManagedBlock(current.content ?? '', desired, markers) });
    }
    const manifest: Manifest = { version: 1, targets, workers };
    changes.push({ ...manifestFile, updated: JSON.stringify(manifest, null, 2) + '\n' });
    await commit(root, changes);
  });
}

export async function globalWorkersStatus(root: string, policy: T3Policy, codexInstructions: string, claudeInstructions: string) {
  const spec = await paths(policy);
  const manifestPath = join(root, 'workers-global.json');
  const manifest = parseManifest((await snapshot(manifestPath)).content);
  if (manifest) validateHomes(manifest, spec.targets, spec.workers.map(w => w.file));
  const targets = await Promise.all(spec.targets.map(async (file, i) => ({ file, installed: section((await snapshot(file)).content) === block(i === 0 ? codexInstructions : claudeInstructions) })));
  const workers = await Promise.all(spec.workers.map(async w => ({ file: w.file, installed: (await snapshot(w.file)).content === w.content })));
  return { installed: !!manifest && targets.every(t => t.installed) && workers.every(w => w.installed), manifest: manifestPath, targets, workers };
}

export async function uninstallGlobalWorkers(root: string): Promise<{ preserved: string[] }> {
  return locked(root, async () => {
    const manifestFile = await snapshot(join(root, 'workers-global.json'));
    const manifest = parseManifest(manifestFile.content);
    if (!manifest) return { preserved: [] };
    // Never follow paths from the manifest unless they match the current homes.
    const { defaultT3Policy } = await import('../t3/routing.ts');
    const spec = await paths(defaultT3Policy);
    validateHomes(manifest, spec.targets, spec.workers.map(w => w.file));
    const changes: Change[] = [];
    const preserved: string[] = [];
    for (const entry of manifest.targets) {
      if (!entry.owned) continue;
      const current = await snapshot(entry.file);
      const existing = section(current.content);
      if (existing !== null && digest(existing) === entry.hash) changes.push({ ...current, updated: updateManagedBlock(current.content!, null, markers) });
      else if (existing !== null) preserved.push(entry.file);
    }
    for (const entry of manifest.workers) {
      if (!entry.owned) continue;
      const current = await snapshot(entry.file);
      if (current.content !== null && digest(current.content) === entry.hash) changes.push({ ...current, updated: null });
      else if (current.content !== null) preserved.push(entry.file);
    }
    changes.push({ ...manifestFile, updated: null });
    await commit(root, changes);
    return { preserved };
  });
}
