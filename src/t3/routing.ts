import * as v from '../core/validate.ts';

// Error messages must not echo unexpected keys from private task payloads.
function object(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  try { return v.object(value, label, keys); }
  catch { throw new Error(`${label} must be an object with only supported fields`); }
}

const tiers = v.tiers;
const families = ['codex', 'claude'] as const;
type Family = typeof families[number];
type Tier = typeof tiers[number];
type Route = { model: string; effort?: string };
export type T3Policy = { version: 1; routing: Record<Family, Record<Tier, Route>> };

export const defaultT3Policy: T3Policy = {
  version: 1,
  routing: {
    codex: {
      routine: { model: 'gpt-6-luna', effort: 'low' }, standard: { model: 'gpt-6.1-terra', effort: 'medium' },
      complex: { model: 'gpt-6.1-sol', effort: 'high' }, demanding: { model: 'gpt-6-astra', effort: 'high' },
    },
    claude: {
      routine: { model: 'claude-haiku-5-5', effort: 'low' }, standard: { model: 'claude-sonnet-5-5', effort: 'medium' },
      complex: { model: 'claude-opus-5-5', effort: 'high' }, demanding: { model: 'claude-fable-5-1', effort: 'high' },
    },
  },
};

export function parseT3Policy(input: unknown): T3Policy {
  const root = object(input, 'policy', ['version', 'routing']);
  if (root.version !== 1) throw new Error('policy.version must be 1');
  const routing = object(root.routing, 'policy.routing', [...families]);
  const parsed = {} as T3Policy['routing'];
  for (const family of families) {
    const routes = object(routing[family], `policy.routing.${family}`, tiers);
    const row = {} as Record<Tier, Route>;
    for (const tier of tiers) {
      const entry = object(routes[tier], `policy.routing.${family}.${tier}`, ['model', 'effort']);
      row[tier] = { model: v.text(entry.model, 'model'), ...(entry.effort === undefined ? {} : { effort: v.oneOf(entry.effort, v.reasoning, 'effort') }) };
    }
    parsed[family] = row;
  }
  return { version: 1, routing: parsed };
}

function fail(message: string): never { throw new Error(message); }
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const instructions = `\n\nWorker instructions: Complete only the bounded task above using the supplied context. Work independently; do not create or delegate to other workers. Preserve other people’s edits. Report findings, validation performed, and any blockers. Your result is not accepted until the primary agent verifies it.`;

export function planT3Delegation(input: unknown, policy: T3Policy = defaultT3Policy) {
  const p = parseT3Policy(policy);
  const request = object(input, 'request', ['task', 'tier', 'family', 'capabilities', 'previous']);
  if (typeof request.task !== 'string' || !request.task.trim() || request.task.length > 32000) fail('task must be nonempty text of at most 32000 characters');
  const tier = v.oneOf(request.tier, tiers, 'tier');
  const family = v.oneOf(request.family, families, 'family');
  const caps = record(request.capabilities);
  const providers = caps && Array.isArray(caps.providers) ? caps.providers : null;
  if (!providers) fail('capabilities.providers must be an array');
  const previous = request.previous === undefined ? null : record(request.previous);
  if (request.previous !== undefined) {
    if (!previous) fail('previous must be an object');
    const oldTier = v.oneOf(previous.tier, tiers, 'previous.tier');
    const oldModel = v.text(previous.model, 'previous.model');
    if (tiers.indexOf(tier) <= tiers.indexOf(oldTier) || !v.text(previous.failure, 'previous.failure').trim()) fail('escalation requires a stronger tier and a reported failure');
    if (p.routing[family][tier].model === oldModel) fail('escalation must select a different model');
  }
  const driver = family === 'codex' ? 'codex' : 'claudeAgent';
  const modelId = p.routing[family][tier].model;
  const matches = providers.map(value => record(value)).filter((provider): provider is Record<string, unknown> => !!provider && provider.driverKind === driver && provider.canRunChildTask === true && Array.isArray(provider.models) && provider.models.some(m => record(m)?.id === modelId));
  if (!matches.length) fail('configured worker model is unavailable or disabled');
  if (matches.length !== 1) fail('ambiguous eligible providers; provide a narrower capabilities snapshot');
  const provider = matches[0]!;
  const providerId = v.text(provider.providerInstanceId, 'providerInstanceId');
  const inherited = caps!.inheritedProviderInstanceId;
  if (inherited !== providerId && provider.canRunCrossProviderChildTask !== true) fail('cross-provider child tasks are disabled or the parent provider is unknown');
  const model = (provider.models as unknown[]).map(record).find(m => m?.id === modelId)!;
  const optionId = family === 'codex' ? 'reasoningEffort' : 'effort';
  const configuredEffort = p.routing[family][tier].effort;
  const options: Record<string, string> = {};
  if (configuredEffort !== undefined) {
    const advertised = Array.isArray(model.options) ? model.options.map(record).find(o => o?.id === optionId) : undefined;
    if (!advertised || !Array.isArray(advertised.values) || !advertised.values.includes(configuredEffort)) fail('configured worker effort is unavailable');
    options[optionId] = configuredEffort;
  }
  const selection = { providerInstanceId: providerId, model: modelId, options };
  const task = `${request.task}${instructions}`;
  return { tier, selection, delegation: { task, mode: 'async' as const, isolation: 'shared' as const, target: selection }, verificationRequired: true as const };
}
