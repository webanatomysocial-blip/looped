// Assistant configuration, read from process.env like the rest of the backend. Server-side only — never send to the frontend.
import { Channel, CHANNELS } from './types';

export type AIProviderName = 'none' | 'mock' | 'openai' | 'anthropic' | 'gemini';
const PROVIDERS: AIProviderName[] = ['none', 'mock', 'openai', 'anthropic', 'gemini'];
const REAL_PROVIDERS: AIProviderName[] = ['openai', 'anthropic', 'gemini'];
const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

export interface AssistantConfig {
  enabled: boolean;
  simulatorEnabled: boolean;
  adapters: Channel[];
  ai: { provider: AIProviderName; model: string | null; apiKey: string | null; timeoutMs: number; maxOutputTokens: number };
  logLevel: typeof LOG_LEVELS[number];
  confirmationTtlSeconds: number;
  contextTtlSeconds: number;
  timezone: string;
  queue: { maxAttempts: number; leaseSeconds: number; queueExpirySeconds: number; executionEnabled: boolean };
  maxConcurrentPerUser: number;
}

export class AssistantConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Assistant configuration invalid: ${problems.join('; ')}`);
    this.name = 'AssistantConfigError';
  }
}

const bool = (v: string | undefined, dflt: boolean) => (v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
function int(v: string | undefined, dflt: number, name: string, problems: string[]): number {
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) { problems.push(`${name} must be a positive integer`); return dflt; }
  return n;
}

export function loadAssistantConfig(env: NodeJS.ProcessEnv = process.env): AssistantConfig {
  const problems: string[] = [];
  const enabled = bool(env.ASSISTANT_ENABLED, false);

  const provider = (env.ASSISTANT_AI_PROVIDER || 'none').toLowerCase() as AIProviderName;
  if (!PROVIDERS.includes(provider)) problems.push(`ASSISTANT_AI_PROVIDER must be one of ${PROVIDERS.join(', ')}`);

  const adapters = (env.ASSISTANT_ADAPTERS || 'simulator').split(',').map((s) => s.trim()).filter(Boolean) as Channel[];
  for (const a of adapters) if (!CHANNELS.includes(a)) problems.push(`unknown adapter "${a}" in ASSISTANT_ADAPTERS`);

  const logLevel = (env.ASSISTANT_LOG_LEVEL || 'info') as AssistantConfig['logLevel'];
  if (!LOG_LEVELS.includes(logLevel)) problems.push(`ASSISTANT_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);

  // OpenAI: OPENAI_API_KEY and ASSISTANT_OPENAI_MODEL are the documented names; generic names still work
  const apiKey = env.ASSISTANT_AI_API_KEY || (provider === 'openai' ? env.OPENAI_API_KEY || null : null);
  const model = env.ASSISTANT_AI_MODEL || (provider === 'openai' ? env.ASSISTANT_OPENAI_MODEL || 'gpt-5.4-nano' : null);
  // Real providers need credentials, but only when the assistant is switched on.
  if (enabled && REAL_PROVIDERS.includes(provider)) {
    if (!apiKey) problems.push(`ASSISTANT_AI_API_KEY is required for provider "${provider}"`);
    if (!model) problems.push(`ASSISTANT_AI_MODEL is required for provider "${provider}"`);
  }

  const cfg: AssistantConfig = {
    enabled,
    simulatorEnabled: bool(env.ASSISTANT_SIMULATOR_ENABLED, false),
    adapters,
    ai: {
      provider, model, apiKey,
      timeoutMs: int(env.ASSISTANT_AI_TIMEOUT_MS, 20000, 'ASSISTANT_AI_TIMEOUT_MS', problems),
      maxOutputTokens: int(env.ASSISTANT_AI_MAX_OUTPUT_TOKENS, 1024, 'ASSISTANT_AI_MAX_OUTPUT_TOKENS', problems),
    },
    logLevel,
    confirmationTtlSeconds: int(env.ASSISTANT_CONFIRMATION_TTL_SECONDS, 600, 'ASSISTANT_CONFIRMATION_TTL_SECONDS', problems),
    contextTtlSeconds: int(env.ASSISTANT_CONTEXT_TTL_SECONDS, 1800, 'ASSISTANT_CONTEXT_TTL_SECONDS', problems),
    timezone: env.ASSISTANT_TIMEZONE || 'Asia/Kolkata',
    queue: {
      maxAttempts: int(env.ASSISTANT_QUEUE_MAX_ATTEMPTS, 3, 'ASSISTANT_QUEUE_MAX_ATTEMPTS', problems),
      leaseSeconds: int(env.ASSISTANT_QUEUE_LEASE_SECONDS, 120, 'ASSISTANT_QUEUE_LEASE_SECONDS', problems),
      queueExpirySeconds: int(env.ASSISTANT_QUEUE_EXPIRY_SECONDS, 900, 'ASSISTANT_QUEUE_EXPIRY_SECONDS', problems),
      // Off by default: nothing executes Loop actions in Phase 4
      executionEnabled: bool(env.ASSISTANT_EXECUTION_ENABLED, false),
    },
    maxConcurrentPerUser: int(env.ASSISTANT_MAX_CONCURRENT_PER_USER, 1, 'ASSISTANT_MAX_CONCURRENT_PER_USER', problems),
  };
  if (problems.length) throw new AssistantConfigError(problems);
  return cfg;
}

// Safe for logs / admin status screens: never includes the key itself.
export function describeConfig(cfg: AssistantConfig) {
  return { ...cfg, ai: { ...cfg.ai, apiKey: cfg.ai.apiKey ? '[set]' : null } };
}
