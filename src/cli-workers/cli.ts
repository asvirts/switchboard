import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, rm, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defaultT3Policy, parseT3Policy } from '../t3/routing.ts';
import { updateManagedBlock } from '../t3/managed-instructions.ts';
import { installClaudeWorkers, claudeWorkerFiles, claudeWorkerInstructions } from './claude.ts';
import { installCodexWorkers, codexWorkerFiles } from './codex.ts';
import type { T3Policy } from '../t3/routing.ts';
import { globalWorkersStatus, installGlobalWorkers, uninstallGlobalWorkers } from './global.ts';

const markers = {
  start: '<!-- switchboard:workers:start -->',
  end: '<!-- switchboard:workers:end -->',
  malformedMessage: 'Malformed Switchboard worker instructions; repair the markers before setup',
};

const codexInstructions = `## Switchboard native Codex workers

Apply this workflow in a primary Codex CLI session when native subagents are available.
In a worker session or task marked SWITCHBOARD_WORKER, do the assigned work yourself;
do not delegate again. T3-specific routing, project instructions and explicit user
choices take precedence. Keep the primary model and settings unchanged.

For substantive work, choose a native Switchboard worker by task complexity:
switchboard_routine, switchboard_standard, switchboard_complex, or
switchboard_demanding. Delegate bounded work before execution; split independent
work when useful and give each worker clear ownership, context, constraints and
checks. Mark each task SWITCHBOARD_WORKER. Review the actual work and verify its
checks before accepting it. Escalate only after a capability failure, using a
stronger tier and passing on the findings. Native provider availability, permissions,
sandboxing and approvals still apply. Do not silently substitute another model.
If the named roles or native subagent tool are unavailable, report that limitation.
This instruction-driven workflow does not guarantee delegation or model access.`;

async function policy(root: string) {
  try { return parseT3Policy(JSON.parse(await readFile(join(root, 't3-policy.json'), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(defaultT3Policy);
    throw new Error('Invalid t3-policy.json; use a complete version 1 T3 policy');
  }
}

async function installInstructions(file: string, body: string): Promise<void> {
  let original: string | null = null;
  let mode = 0o644;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Instruction target must be a regular file, not a symlink');
    mode = info.mode & 0o777;
    original = await readFile(file, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const block = `${markers.start}\n${body}\n${markers.end}`;
  const updated = updateManagedBlock(original ?? '', block, markers);
  if (updated === original) return;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', mode);
    try { await handle.writeFile(updated); await handle.sync(); } finally { await handle.close(); }
    if (original === null) await link(temporary, file);
    else {
      if (await readFile(file, 'utf8') !== original) throw new Error('Instructions changed during setup; retry');
      await rename(temporary, file);
    }
  } finally { await rm(temporary, { force: true }); }
}

async function preflight(project: string, current: T3Policy, codexInstructionsFile: string): Promise<void> {
  for (const directory of ['.codex', '.codex/agents', '.claude', '.claude/agents']) {
    try {
      const info = await lstat(join(project, directory));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected a real directory: ${directory}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const files = [
    ...codexWorkerFiles(current),
    ...Object.entries(claudeWorkerFiles(current)).map(([name, content]) => ({ path: `.claude/agents/${name}`, content })),
  ];
  for (const file of files) {
    try {
      const path = join(project, file.path);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || await readFile(path, 'utf8') !== file.content) {
        throw new Error(`Refusing to overwrite existing worker: ${file.path}`);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const name of [codexInstructionsFile, 'CLAUDE.md']) {
    try {
      const file = join(project, name);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Instruction target must be a regular file, not a symlink');
      updateManagedBlock(await readFile(file, 'utf8'), null, markers);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export async function workersCommand(root: string, args: string[]): Promise<number> {
  const global = args.length === 2 && args[1] === '--global' && ['init', 'status', 'uninstall'].includes(args[0]!);
  if (!global && (args.length !== 1 || args[0] !== 'init')) throw new Error('Usage: switchboard workers init [--global] | workers <status|uninstall> --global');
  if (global && args[0] === 'uninstall') {
    const result = await uninstallGlobalWorkers(root);
    if (result.preserved.length) {
      console.log('Removed unmodified global worker routing. These edited files or blocks were preserved:');
      for (const file of result.preserved) console.log(`  ${file}`);
    } else console.log('Removed global native worker routing. Other instructions and settings are preserved.');
    return 0;
  }
  const current = await policy(root);
  if (global && args[0] === 'status') {
    console.log(JSON.stringify(await globalWorkersStatus(root, current, codexInstructions, claudeWorkerInstructions()), null, 2));
    return 0;
  }
  if (global) {
    await installGlobalWorkers(root, current, codexInstructions, claudeWorkerInstructions());
    console.log('Global native worker routing installed for Codex and Claude. Start a new native CLI session.');
    console.log('Model availability and native delegation must be verified separately.');
    return 0;
  }
  const project = resolve('.');
  let codexInstructionsFile = 'AGENTS.md';
  try { await lstat(join(project, 'AGENTS.override.md')); codexInstructionsFile = 'AGENTS.override.md'; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await preflight(project, current, codexInstructionsFile);
  const codex = await installCodexWorkers(project, current);
  const claude = await installClaudeWorkers(project, current);
  await installInstructions(join(project, codexInstructionsFile), codexInstructions);
  await installInstructions(join(project, 'CLAUDE.md'), claudeWorkerInstructions());
  console.log(`Installed native worker definitions for this project (${codex.length} Codex, ${claude.length} Claude).`);
  console.log('Start a new native CLI session. Model availability and native delegation must be verified separately.');
  console.log(`Policy: ${join(root, 't3-policy.json')} if present; otherwise shipped T3 defaults.`);
  return 0;
}
