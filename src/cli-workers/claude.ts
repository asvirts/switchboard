import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseT3Policy, type T3Policy } from '../t3/routing.ts';

const tiers = ['routine', 'standard', 'complex', 'demanding'] as const;
const descriptions = {
  routine: 'Bounded routine work, mechanical edits and focused lookup',
  standard: 'Familiar implementation or analysis with clear acceptance checks',
  complex: 'Difficult debugging, complex implementation or broad review',
  demanding: 'Unusually demanding reasoning or investigation',
};

/** Return project-scoped Claude Code subagent definitions for the configured policy. */
export function claudeWorkerFiles(policy: T3Policy): Record<string, string> {
  const parsed = parseT3Policy(policy);
  return Object.fromEntries(tiers.map(tier => {
    const name = `switchboard-${tier}`;
    const route = parsed.routing.claude[tier];
    // JSON strings are valid YAML scalars, including for user-supplied model IDs.
    const file = `---\nname: ${name}\ndescription: ${descriptions[tier]}\nmodel: ${JSON.stringify(route.model)}\n${route.effort ? `effort: ${JSON.stringify(route.effort)}\n` : ''}---\n\n` +
      'Complete the bounded assignment independently. Do not spawn or delegate to other workers. ' +
      'Preserve other people’s edits, respect project instructions and native permissions, and report findings, checks, and blockers.\n';
    return [`${name}.md`, file];
  }));
}

/** Instructions for a primary Claude Code session; caller manages the containing file. */
export function claudeWorkerInstructions(): string {
  return `## Switchboard worker routing for Claude Code

Apply this workflow only in a primary Claude Code CLI session. In a child or
worker session, complete the assigned work without spawning more workers. In T3
Code, use its own applicable workflow instead. Explicit user and project
instructions take precedence.

Keep the primary model unchanged. For substantive requests, scope bounded tasks
and use the native Agent tool to delegate to the smallest sufficient named
Switchboard worker: switchboard-routine for mechanical work and bounded lookup,
switchboard-standard for familiar implementation, switchboard-complex for hard
debugging or broad review, and switchboard-demanding for unusually hard reasoning.
Parallelize independent tasks with disjoint file ownership; sequence dependencies.
Give each worker context, scope and acceptance checks. Review the actual result
and run appropriate checks before integrating it. On a capability failure, use a
stronger tier with the findings and failed checks; do not retry permission failures
or override a user's explicit model choice. Simple acknowledgments and logistics
can stay direct.

Use each named agent's configured model and effort; do not pass per-invocation
overrides unless explicitly requested. Native model availability, permissions and
approvals remain under Claude Code's control. The definitions and this workflow do
not guarantee delegation, model availability, or a particular runtime model.`;
}

async function ensureDirectory(path: string): Promise<void> {
  try { await mkdir(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected a directory: ${path}`);
}

/** Install only into projectDir/.claude/agents, refusing to replace existing edits. */
export async function installClaudeWorkers(projectDir: string, policy: T3Policy): Promise<string[]> {
  const files = claudeWorkerFiles(policy);
  const project = resolve(projectDir);
  const projectInfo = await lstat(project);
  if (!projectInfo.isDirectory() || projectInfo.isSymbolicLink()) throw new Error('Project must be a directory');
  const configDir = join(project, '.claude');
  const agentsDir = join(configDir, 'agents');
  await ensureDirectory(configDir);
  await ensureDirectory(agentsDir);
  const paths = Object.keys(files).map(name => join(agentsDir, name));
  const missing: string[] = [];
  // Check all paths before writing so a normal conflict cannot partially install.
  for (const [name, contents] of Object.entries(files)) {
    const path = join(agentsDir, name);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || await readFile(path, 'utf8') !== contents) {
        throw new Error(`Claude worker file already exists with different content: ${path}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.push(name);
      else throw error;
    }
  }
  // Exclusive creation protects files created between preflight and writing.
  for (const name of missing) await writeFile(join(agentsDir, name), files[name]!, { flag: 'wx', mode: 0o644 });
  return paths;
}
