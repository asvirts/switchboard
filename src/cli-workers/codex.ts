import { lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stringify } from 'smol-toml';
import { parseT3Policy, type T3Policy } from '../t3/routing.ts';

const tiers = ['routine', 'standard', 'complex', 'demanding'] as const;
const descriptions = {
  routine: 'Bounded mechanical work and focused lookups.',
  standard: 'Familiar implementation with clear acceptance checks.',
  complex: 'Difficult debugging or broad review.',
  demanding: 'Unusually difficult reasoning and investigation.',
};

/** Generate native Codex agent files relative to the project root, without writing. */
export function codexWorkerFiles(policy: T3Policy): Array<{ path: string; content: string }> {
  const routing = parseT3Policy(policy).routing.codex;
  return tiers.map(tier => {
    const route = routing[tier];
    return {
      path: `.codex/agents/switchboard_${tier}.toml`,
      content: stringify({
        name: `switchboard_${tier}`,
        description: `Switchboard ${tier} worker: ${descriptions[tier]}`,
        model: route.model,
        ...(route.effort === undefined ? {} : { model_reasoning_effort: route.effort }),
        developer_instructions: 'Complete the assigned bounded task yourself; do not spawn or delegate to other workers. Preserve other people’s edits. Report findings, checks, and blockers. The primary must independently verify your result.',
      }),
    };
  });
}

async function directory(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(path);
  }
}

/** Install project-scoped native roles; refuse to replace any nonmatching file. */
export async function installCodexWorkers(projectDir: string, policy: T3Policy): Promise<string[]> {
  const root = resolve(projectDir);
  const files = codexWorkerFiles(policy);
  await directory(join(root, '.codex'));
  await directory(join(root, '.codex', 'agents'));
  const create: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    const path = join(root, file.path);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || await readFile(path, 'utf8') !== file.content) {
        throw new Error(`Refusing to overwrite existing Codex worker: ${path}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      create.push({ path, content: file.content });
    }
  }
  const written: string[] = [];
  try {
    for (const file of create) {
      const handle = await open(file.path, 'wx', 0o644);
      written.push(file.path);
      try { await handle.writeFile(file.content); } finally { await handle.close(); }
    }
  } catch (error) {
    // Remove only files we created and whose contents still match our own output.
    for (const path of written) {
      const expected = create.find(file => file.path === path)!.content;
      if (await readFile(path, 'utf8').catch(() => null) === expected) await rm(path, { force: true });
    }
    throw error;
  }
  return files.map(file => join(root, file.path));
}
