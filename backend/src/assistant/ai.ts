// Provider-independent AI layer. Pipeline code depends only on AIProvider + the parsers below.
import { AssistantConfig } from './config';
import { Entities } from './types';

export interface AIUsage { inputTokens: number; outputTokens: number }
// feature: what the call is for, used only to group recorded token usage (never sent to the provider)
export interface AICompletionRequest { system: string; user: string; maxOutputTokens?: number; jsonOnly?: boolean; feature?: string }
export interface AICompletion { text: string; model: string; usage: AIUsage; id?: string }

export interface AIProvider {
  readonly name: string;
  complete(req: AICompletionRequest): Promise<AICompletion>;
}

export type AIErrorCode = 'not_configured' | 'unsupported' | 'timeout' | 'rate_limited' | 'provider_error' | 'invalid_response';
// Log-safe summary of a provider failure: the category only. Never the message, keys, headers or request content.
export function describeAIFailure(e: unknown): string {
  if (e instanceof AIError) return `code=${e.code}`;
  return `code=unexpected type=${(e as any)?.constructor?.name ?? 'unknown'}`;
}

export class AIError extends Error {
  constructor(public readonly code: AIErrorCode, message: string, public readonly retryable = false) {
    super(message);
    this.name = 'AIError';
  }
}

export interface UsageRecorder { record(provider: string, model: string, usage: AIUsage): void }
export class InMemoryUsageRecorder implements UsageRecorder {
  totals = { calls: 0, inputTokens: 0, outputTokens: 0 };
  record(_p: string, _m: string, u: AIUsage) {
    this.totals.calls++; this.totals.inputTokens += u.inputTokens; this.totals.outputTokens += u.outputTokens;
  }
}

// Deterministic, free provider for tests and the simulator. Replies are scripted, never generated.
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  calls: AICompletionRequest[] = [];
  constructor(private readonly reply: string | ((req: AICompletionRequest) => string) = '{"intent":"unknown","confidence":0,"entities":{}}') {}
  async complete(req: AICompletionRequest): Promise<AICompletion> {
    this.calls.push(req);
    const text = typeof this.reply === 'function' ? this.reply(req) : this.reply;
    return { text, model: 'mock', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

// ── HTTP providers. fetch is injectable so tests never hit the network. ──

type FetchFn = typeof fetch;
interface HttpOpts { apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number; fetchFn?: FetchFn }

async function postJson(fetchFn: FetchFn, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new AIError('timeout', 'AI provider timed out', true);
    throw new AIError('provider_error', 'AI provider unreachable', true);
  }
  // Never echo provider bodies: they can contain the prompt or account details
  if (res.status === 429) throw new AIError('rate_limited', 'AI provider rate limit', true);
  if (res.status === 401 || res.status === 403) throw new AIError('not_configured', 'AI provider rejected the credentials');
  if (!res.ok) throw new AIError('provider_error', `AI provider returned HTTP ${res.status}`, res.status >= 500);
  try { return await res.json(); } catch { throw new AIError('invalid_response', 'AI provider returned non-JSON'); }
}

const needText = (t: unknown): string => {
  if (typeof t !== 'string') throw new AIError('invalid_response', 'AI provider returned no text');
  return t;
};

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  constructor(private readonly o: HttpOpts) {}
  async complete(req: AICompletionRequest): Promise<AICompletion> {
    const j = await postJson(this.o.fetchFn ?? fetch, 'https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${this.o.apiKey}` }, {
      model: this.o.model,
      max_completion_tokens: req.maxOutputTokens ?? this.o.maxOutputTokens,
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      ...(req.jsonOnly ? { response_format: { type: 'json_object' } } : {}),
    }, this.o.timeoutMs);
    return { id: typeof j?.id === 'string' ? j.id : undefined, text: needText(j?.choices?.[0]?.message?.content), model: j?.model ?? this.o.model, usage: { inputTokens: j?.usage?.prompt_tokens ?? 0, outputTokens: j?.usage?.completion_tokens ?? 0 } };
  }
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  constructor(private readonly o: HttpOpts) {}
  async complete(req: AICompletionRequest): Promise<AICompletion> {
    const j = await postJson(this.o.fetchFn ?? fetch, 'https://api.anthropic.com/v1/messages', { 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01' }, {
      model: this.o.model,
      max_tokens: req.maxOutputTokens ?? this.o.maxOutputTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    }, this.o.timeoutMs);
    const text = Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('') : undefined;
    return { text: needText(text || undefined), model: j?.model ?? this.o.model, usage: { inputTokens: j?.usage?.input_tokens ?? 0, outputTokens: j?.usage?.output_tokens ?? 0 } };
  }
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  constructor(private readonly o: HttpOpts) {}
  async complete(req: AICompletionRequest): Promise<AICompletion> {
    // Key goes in a header, not the URL, so it never lands in proxy/access logs
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.o.model)}:generateContent`;
    const j = await postJson(this.o.fetchFn ?? fetch, url, { 'x-goog-api-key': this.o.apiKey }, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: { maxOutputTokens: req.maxOutputTokens ?? this.o.maxOutputTokens, ...(req.jsonOnly ? { responseMimeType: 'application/json' } : {}) },
    }, this.o.timeoutMs);
    const parts = j?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? '').join('') : undefined;
    return { text: needText(text || undefined), model: this.o.model, usage: { inputTokens: j?.usageMetadata?.promptTokenCount ?? 0, outputTokens: j?.usageMetadata?.candidatesTokenCount ?? 0 } };
  }
}

export function createAIProvider(cfg: AssistantConfig['ai'], fetchFn?: FetchFn): AIProvider {
  if (cfg.provider === 'mock') return new MockAIProvider();
  if (cfg.provider === 'none') throw new AIError('not_configured', 'No AI provider configured (ASSISTANT_AI_PROVIDER=none)');
  if (!cfg.apiKey || !cfg.model) throw new AIError('not_configured', `ASSISTANT_AI_API_KEY and ASSISTANT_AI_MODEL are required for "${cfg.provider}"`);
  const o: HttpOpts = { apiKey: cfg.apiKey, model: cfg.model, timeoutMs: cfg.timeoutMs, maxOutputTokens: cfg.maxOutputTokens, fetchFn };
  switch (cfg.provider) {
    case 'openai': return new OpenAIProvider(o);
    case 'anthropic': return new AnthropicProvider(o);
    case 'gemini': return new GeminiProvider(o);
    default: throw new AIError('not_configured', `Unknown AI provider "${cfg.provider}"`);
  }
}

// ── Structured parsing: AI output is untrusted text until it passes these checks ──

// Closed set. Anything else the model invents collapses to 'unknown'.
export const INTENTS = [
  'tasks.list_mine', 'tasks.list_overdue', 'tasks.create', 'tasks.update', 'tasks.assign',
  'projects.status', 'projects.budget', 'help', 'unknown',
] as const;
export type Intent = typeof INTENTS[number];

export interface IntentResult { intent: Intent; confidence: number; entities: Entities }

export interface IntentClassifier { classify(text: string): Promise<IntentResult> }
export interface EntityExtractor { extract(text: string, intent: Intent): Promise<Entities> }

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(trimmed); } catch { throw new AIError('invalid_response', 'AI response was not valid JSON'); }
}

function sanitizeEntities(raw: unknown): Entities {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Entities = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z_][a-z0-9_]{0,40}$/i.test(k)) continue;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v as any;
    else if (typeof v === 'string') out[k] = v.slice(0, 500);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = (v as string[]).slice(0, 20).map((s) => s.slice(0, 200));
  }
  return out;
}

export function parseIntentResponse(text: string): IntentResult {
  const obj = extractJson(text) as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') throw new AIError('invalid_response', 'AI response was not an object');
  const intent = (INTENTS as readonly string[]).includes(obj.intent as string) ? (obj.intent as Intent) : 'unknown';
  const c = Number(obj.confidence);
  const confidence = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
  return { intent, confidence, entities: sanitizeEntities(obj.entities) };
}

// Default classifier built on any provider. The prompt is placeholder-grade; Phase 3 tunes it.
export class LLMIntentClassifier implements IntentClassifier {
  constructor(private readonly provider: AIProvider, private readonly usage?: UsageRecorder) {}
  async classify(text: string): Promise<IntentResult> {
    const res = await this.provider.complete({
      system: `Classify the user's request for the Loop agency app. Reply with JSON only: {"intent": one of ${INTENTS.join('|')}, "confidence": 0..1, "entities": {}}.`,
      user: text,
      jsonOnly: true,
    });
    this.usage?.record(this.provider.name, res.model, res.usage);
    return parseIntentResponse(res.text);
  }
}
