import { createHash } from 'node:crypto';
import { claudeConversationSignature, claudeUserTextBlocks, normalizeMatchText } from './protocol.ts';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
type PromptHook = { promptId: string; prompt: string; digest: string };
type ConsumedPrompt = Pick<PromptHook, 'promptId' | 'prompt'>;
type Match = { fingerprint: string; event?: PromptHook; previous?: ConsumedPrompt };

// Tracks the bounded, process-local evidence supplied by Claude's hooks. It
// does not choose a route or decide whether a missing route is recoverable.
export class ClaudeTurnEvidence {
  private readonly pending = new Map<string, PromptHook[]>();
  private readonly consumed = new Map<string, Map<string, ConsumedPrompt>>();
  private readonly sessions = new Map<string, 'fresh' | 'resume'>();

  private readonly maxContextChars: number;

  constructor(maxContextChars: number) { this.maxContextChars = maxContextChars; }

  recordSession(sessionId: string, source: string): void {
    if (!this.sessions.has(sessionId) && this.sessions.size >= 128) this.sessions.delete(this.sessions.keys().next().value!);
    // Delayed lifecycle delivery cannot turn a resumed identity fresh.
    const resumed = this.sessions.get(sessionId) === 'resume' || !['startup', 'clear'].includes(source);
    this.sessions.set(sessionId, resumed ? 'resume' : 'fresh');
  }

  recordPrompt(sessionId: string, promptId: string, prompt: string): void {
    if (!this.pending.has(sessionId) && this.pending.size >= 128) this.pending.delete(this.pending.keys().next().value!);
    const events = this.pending.get(sessionId) ?? [];
    if (!events.some(event => event.promptId === promptId)) events.push({ promptId, prompt: prompt.slice(0, this.maxContextChars + 1), digest: digest(normalizeMatchText(prompt)) });
    this.pending.set(sessionId, events.slice(-8));
  }

  isResumed(sessionId: string): boolean { return this.sessions.get(sessionId) === 'resume'; }

  match(sessionId: string, messages: unknown, task: string, isUser: boolean): Match {
    const fingerprint = digest(claudeConversationSignature(messages));
    const candidates = new Set(claudeUserTextBlocks(messages).map(digest));
    if (isUser && task) candidates.add(digest(normalizeMatchText(task)));
    const matches = (this.pending.get(sessionId) ?? []).filter(event => candidates.has(event.digest));
    return { fingerprint, event: matches.length === 1 ? matches[0] : undefined,
      previous: matches.length === 0 ? this.consumed.get(sessionId)?.get(fingerprint) : undefined };
  }

  matchedPrompt(match: Match): string | undefined { return (match.event ?? match.previous)?.prompt; }

  resolve(sessionId: string, match: Match | undefined, task: string, allowContent: boolean):
    | { kind: 'hook'; task: string; turnId: string }
    | { kind: 'content'; task: string; turnId: string }
    | { kind: 'missing' } {
    const events = this.pending.get(sessionId) ?? [];
    const event = match?.event;
    if (event) events.splice(events.indexOf(event), 1);
    if (!events.length) this.pending.delete(sessionId);
    if (event) {
      if (!this.consumed.has(sessionId) && this.consumed.size >= 128) this.consumed.delete(this.consumed.keys().next().value!);
      const turns = this.consumed.get(sessionId) ?? new Map();
      turns.set(match!.fingerprint, { promptId: event.promptId, prompt: event.prompt });
      while (turns.size > 8) turns.delete(turns.keys().next().value!);
      this.consumed.set(sessionId, turns);
      return { kind: 'hook', task: event.prompt, turnId: event.promptId };
    }
    if (match?.previous) return { kind: 'hook', task: match.previous.prompt, turnId: match.previous.promptId };
    if (allowContent && this.sessions.get(sessionId) === 'fresh' && task.trim()) return { kind: 'content', task, turnId: `content-${match?.fingerprint ?? ''}` };
    return { kind: 'missing' };
  }
}
