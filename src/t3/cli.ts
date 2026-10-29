import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicJsonWrite } from '../storage.ts';
import { defaultT3Policy, parseT3Policy, planT3Delegation } from './routing.ts';
import { globalStatus, installGlobal, uninstallGlobal } from './global.ts';
import { updateManagedBlock } from './managed-instructions.ts';

const start = '<!-- switchboard:t3:start -->';
const end = '<!-- switchboard:t3:end -->';
const markers = { start, end, malformedMessage: 'AGENTS.md has malformed Switchboard markers; fix them before setup' };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function t3Instructions(entry: string, root: string): string {
  const command = `SWITCHBOARD_HOME=${quote(resolve(root))} ${quote(process.execPath)} ${quote(resolve(entry))} t3 route`;
  return `${start}
## Switchboard worker routing for T3 Code

Apply this workflow only in primary T3 sessions exposing orchestrator_capabilities
and delegate_task. In a worker/child session or an assignment marked
SWITCHBOARD_WORKER, complete your task yourself without launching workers.
Outside T3 the workflow is inactive. Project instructions and explicit user
choices take precedence. Apply this workflow once if both global and project
instructions enable it.

Keep the primary model stable and in charge of coordination, scoping, verification,
and synthesis. Every substantive request (coding, research, analysis, or substantive
answers) gets at least one worker; simple acknowledgments and logistics can stay
direct. The primary may do minimal scoping and verification reads, but delegates
substantive execution. Do not complete substantive work first and delegate afterward.

For bounded delegated work:
1. Call orchestrator_capabilities once per thread before the first delegate_task.
   Refresh only after an error or a user-named provider change. Use its current
   provider/model/options snapshot; do not invent availability or credentials.
2. Before execution, decompose the work into dependency and ownership boundaries.
   Choose the worker count, tier, and provider family for each subtask using the
   live capability snapshot. Parallelize independent work and sequence dependent
   work. Mix Codex and Claude workers when their available capabilities fit the
   subtasks; there is no fixed worker count or default family match. Weigh useful
   parallelism against duplicated context, coordination overhead, and expected
   retries; savings are not guaranteed. Choose the smallest sufficient tier:
   routine for mechanical work and bounded
   lookup; standard for familiar implementation with clear checks; complex for
   difficult debugging or broad review; demanding for unusually hard reasoning.
   Gather missing context before choosing. These are judgments, not guarantees.
   Explicit user worker choices and project constraints take precedence.
3. Send JSON on stdin to ${command}
   with {task, tier, family, capabilities}. The task must be self-contained: scope,
   relevant findings, file ownership, constraints, and concrete acceptance checks.
   Children have no parent history. Never shell-interpolate task text; use safely
   quoted stdin. Do not save raw tasks or capability dumps to repository files.
4. Call T3 delegate_task with the returned delegation object. The route command
   plans only; it does not run a model. Keep target.options exactly as returned.
   Preserve the primary's native authentication, sandbox, approvals and settings.
   For an explicitly requested separate checkout use isolation worktree through T3;
   never create a child's checkout in a shell. Assign disjoint ownership to parallel
   workers. Delegate every substantive subtask before execution; do not defer
   delegation until after substantive work is complete.
5. Follow the delegate's next instruction. An async delegate wakes this thread:
   end the turn instead of polling or sleeping. Questions and approvals remain
   pending until answered by an authorized party. Cancel replaced workers by
   taskId before starting replacements. Follow T3's native PR and thread-link rules.
6. Review the actual result and relevant checks. A worker's success claim is not
   verification. If capability is the blocker, reroute with a strictly higher tier
   and previous: {tier, model, failure}; include findings and failed checks in task.
   Allow at most two escalations for a task. At the limit, report the blocker.
   Do not escalate permission failures or silently change a
   requested model/provider. Unsupported routes require an explicit policy choice.

Worker model pinning applies within each worker session. This workflow does not
change the primary model, install a proxy, or grant approval authority to workers.
${end}`;
}

async function policy(root: string) {
  try {
    const raw = await readFile(join(root, 't3-policy.json'), 'utf8');
    try { return parseT3Policy(JSON.parse(raw)); }
    catch { throw new Error('Invalid t3-policy.json; use a complete version 1 T3 policy'); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(defaultT3Policy);
    throw error;
  }
}

async function installInstructions(file: string, block: string): Promise<void> {
  let original = '';
  let mode = 0o644;
  let exists = false;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('AGENTS.md must be a regular file');
    mode = info.mode & 0o777;
    original = await readFile(file, 'utf8');
    exists = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const updated = updateManagedBlock(original, block, markers);
  if (updated === original) return;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', mode);
    try { await handle.writeFile(updated); await handle.sync(); } finally { await handle.close(); }
    // Avoid overwriting instructions edited while setup prepared its replacement.
    if (exists) {
      if (await readFile(file, 'utf8') !== original) throw new Error('AGENTS.md changed during setup; retry');
      await rename(temporary, file);
    } else {
      const { link } = await import('node:fs/promises');
      await link(temporary, file);
    }
  } finally { await rm(temporary, { force: true }); }
}

export async function t3Command(root: string, args: string[]): Promise<number> {
  const global = args.length === 2 && args[1] === '--global' && ['init', 'status', 'uninstall'].includes(args[0]!);
  if (!global && (args.length !== 1 || !['init', 'instructions', 'policy', 'route'].includes(args[0]!))) {
    throw new Error('Usage: switchboard t3 <init|instructions|policy|route> or t3 <init|status|uninstall> --global');
  }
  const command = args[0];
  if (global && command === 'status') { console.log(JSON.stringify(await globalStatus(root), null, 2)); return 0; }
  if (global && command === 'uninstall') {
    await uninstallGlobal(root);
    console.log('Removed global Switchboard instruction blocks. Other instructions, policy, workflow, and backups are preserved.');
    return 0;
  }
  if (command === 'instructions') {
    console.log(t3Instructions(process.argv[1]!, root));
    return 0;
  }
  const current = await policy(root);
  if (command === 'policy') { console.log(JSON.stringify(current, null, 2)); return 0; }
  if (command === 'init') {
    if (global) {
      await installGlobal(root, t3Instructions(process.argv[1]!, root));
      const file = join(root, 't3-policy.json');
      try { await atomicJsonWrite(file, current, { replace: false }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      console.log(`Global T3 routing installed for Codex and Claude. Policy: ${file}`);
      console.log('Start a new T3 conversation. Standalone sessions and delegated workers are excluded by the instructions.');
      return 0;
    }
    const file = join(root, 't3-policy.json');
    try { await atomicJsonWrite(file, current, { replace: false }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    await installInstructions(resolve('AGENTS.md'), t3Instructions(process.argv[1]!, root));
    console.log(`T3 routing installed in this project's AGENTS.md. Policy: ${file}`);
    console.log('Start a new T3 conversation in this project. Your primary model stays selected.');
    return 0;
  }
  if (process.stdin.isTTY) throw new Error('t3 route requires a JSON request on stdin');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new Error('T3 routing request exceeds 2 MB');
    chunks.push(buffer);
  }
  let input: unknown;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('T3 routing request must be valid JSON'); }
  console.log(JSON.stringify(planT3Delegation(input, current), null, 2));
  return 0;
}
