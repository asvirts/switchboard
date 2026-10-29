import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { managedBlockBounds, updateManagedBlock } from './managed-instructions.ts';

const start = '<!-- switchboard:t3:global:start -->';
const end = '<!-- switchboard:t3:global:end -->';
const markers = { start, end, malformedMessage: 'Malformed global Switchboard markers; repair the instruction file before setup' };
interface Snapshot { file: string; content: string | null; mode: number }
interface Change extends Snapshot { updated: string }

async function snapshot(file: string): Promise<Snapshot> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Global instruction targets must be regular files, not symlinks');
    return { file, content: await readFile(file, 'utf8'), mode: info.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { file, content: null, mode: 0o600 };
    throw error;
  }
}

async function targets(): Promise<string[]> {
  const codex = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  const claude = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
  let override = false;
  try { await lstat(join(codex, 'AGENTS.override.md')); override = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return [join(codex, override ? 'AGENTS.override.md' : 'AGENTS.md'), join(claude, 'CLAUDE.md')];
}

function pointer(workflow: string): string {
  return `${start}
## Switchboard routing in T3 Code

For every substantive request in a primary T3 conversation exposing
orchestrator_capabilities and delegate_task, read ${JSON.stringify(workflow)}
before starting work. Delegate execution and coordinate the worker team according
to that workflow. Project instructions and explicit user choices take precedence.
In a delegated worker/child session, or an assignment marked SWITCHBOARD_WORKER,
complete the assigned task yourself; this workflow is inactive and you must not
launch workers. Outside T3, this block is inactive.
${end}`;
}

async function unchanged(previous: Snapshot): Promise<void> {
  const current = await snapshot(previous.file);
  if (current.content !== previous.content) throw new Error('Global instructions changed during setup; retry');
}

// Stage every replacement before touching instruction files. Keep originals private.
async function commit(root: string, changes: Change[]): Promise<void> {
  const pending = changes.filter(change => change.updated !== (change.content ?? ''));
  if (!pending.length) return;
  const backupRoot = join(root, 't3-global-backups', randomUUID());
  const staged: Array<{ change: Change; temporary: string }> = [];
  const applied: Change[] = [];
  try {
    for (const [index, change] of pending.entries()) {
      if (change.content !== null) {
        await mkdir(backupRoot, { recursive: true, mode: 0o700 });
        await writeFile(join(backupRoot, `${index}-${change.file.split('/').at(-1)}.bak`), change.content, { flag: 'wx', mode: 0o600 });
      }
      await mkdir(dirname(change.file), { recursive: true, mode: 0o700 });
      const temporary = `${change.file}.${randomUUID()}.tmp`;
      staged.push({ change, temporary });
      const handle = await open(temporary, 'wx', change.mode);
      try { await handle.writeFile(change.updated); await handle.sync(); } finally { await handle.close(); }
    }
    for (const change of pending) await unchanged(change);
    for (const { change, temporary } of staged) {
      await unchanged(change);
      if (change.content === null) {
        const { link } = await import('node:fs/promises');
        await link(temporary, change.file);
      } else await rename(temporary, change.file);
      applied.push(change);
    }
  } catch (error) {
    let restored = true;
    for (const change of applied.reverse()) {
      try {
        // Preserve edits made by another process after our replacement.
        if ((await snapshot(change.file)).content !== change.updated) { restored = false; continue; }
        if (change.content === null) await rm(change.file);
        else {
          const restore = `${change.file}.${randomUUID()}.restore`;
          try {
            await writeFile(restore, change.content, { flag: 'wx', mode: change.mode });
            await rename(restore, change.file);
          } finally { await rm(restore, { force: true }); }
        }
      } catch { restored = false; }
    }
    if (!restored) throw new Error(`Global setup stopped; inspect saved files and private backups in ${backupRoot}`);
    throw error;
  } finally {
    for (const { temporary } of staged) await rm(temporary, { force: true });
  }
}

async function locked(root: string, action: () => Promise<void>): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = join(root, 't3-global.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another global setup holds t3-global.lock; finish it before retrying');
    throw error;
  }
  try { await action(); }
  finally { await handle.close(); await rm(file, { force: true }); }
}

export async function installGlobal(root: string, workflowContent: string): Promise<void> {
  await locked(root, async () => {
    const files = await targets();
    const workflow = join(root, 't3-instructions.md');
    const changes: Change[] = [];
    for (const file of files) {
      const previous = await snapshot(file);
      changes.push({ ...previous, updated: updateManagedBlock(previous.content ?? '', pointer(workflow), markers) });
    }
    const previous = await snapshot(workflow);
    if (previous.content !== null && (!previous.content.startsWith('<!-- switchboard:t3:start -->') || !previous.content.trimEnd().endsWith('<!-- switchboard:t3:end -->'))) {
      throw new Error('t3-instructions.md is not a generated Switchboard workflow; preserve or move it before setup');
    }
    // Commit the workflow before the pointers, so a pointer always has a target.
    changes.unshift({ ...previous, updated: workflowContent + '\n' });
    await commit(root, changes);
  });
}

export async function uninstallGlobal(root: string): Promise<void> {
  await locked(root, async () => {
    const changes: Change[] = [];
    for (const file of await targets()) {
      const previous = await snapshot(file);
      changes.push({ ...previous, updated: updateManagedBlock(previous.content ?? '', null, markers) });
    }
    await commit(root, changes);
  });
}

export async function globalStatus(root: string) {
  const workflow = join(root, 't3-instructions.md');
  const results = [];
  for (const file of await targets()) {
    const current = await snapshot(file);
    const section = managedBlockBounds(current.content ?? '', markers);
    results.push({ file, installed: section !== null && current.content!.slice(section.from, section.to) === pointer(workflow) });
  }
  const saved = await snapshot(workflow);
  const workflowPresent = saved.content !== null && saved.content.startsWith('<!-- switchboard:t3:start -->') && saved.content.trimEnd().endsWith('<!-- switchboard:t3:end -->');
  return { installed: workflowPresent && results.every(result => result.installed), workflow, targets: results };
}
