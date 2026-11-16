// Actual AI token consumption, persisted. Every provider call goes through RecordingAIProvider, which stores the usage
// fields the provider returned (OpenAI: prompt_tokens / completion_tokens). Nothing is estimated, and no call is made
// to fill the dashboard. Rows exist only from the day this was introduced; earlier usage was never stored.
import { Knex } from 'knex';
import type { AIProvider, AICompletionRequest, AICompletion } from './ai';

export const USAGE_FEATURES = ['group_question', 'intent_classification', 'clarification', 'other'] as const;
export type UsageFeature = typeof USAGE_FEATURES[number];
const TZ_OFFSET_MS = 5.5 * 3_600_000; // Asia/Kolkata, no daylight saving
const DAY_MS = 86_400_000;

export async function ensureUsageSchema(db: Knex): Promise<void> {
  if (await db.schema.hasTable('assistant_ai_usage')) return;
  await db.schema.createTable('assistant_ai_usage', (t) => {
    t.increments('id').primary();
    t.string('response_id', 100).nullable().unique();   // the provider's id for the call: a replayed record is refused
    t.string('provider', 20).notNullable();
    t.string('model', 60).notNullable();
    t.string('feature', 30).notNullable();
    t.integer('input_tokens').notNullable().defaultTo(0);
    t.integer('output_tokens').notNullable().defaultTo(0);
    t.integer('total_tokens').notNullable().defaultTo(0);
    t.boolean('success').notNullable().defaultTo(true);
    t.string('error_code', 30).nullable();                // category only, never a provider message
    t.timestamp('created_at').notNullable();
    t.index(['created_at']);
  });
}

// Wraps the real provider. One row per call actually made: a retry is a second billed call and gets its own row; the
// same response is never stored twice. A recording failure never affects the answer.
export class RecordingAIProvider implements AIProvider {
  constructor(private readonly inner: AIProvider, private readonly db: () => Knex, private readonly now: () => Date = () => new Date()) {}
  get name() { return this.inner.name; }
  async complete(req: AICompletionRequest): Promise<AICompletion> {
    const feature: UsageFeature = (USAGE_FEATURES as readonly string[]).includes(req.feature ?? '') ? req.feature as UsageFeature : 'other';
    try {
      const out = await this.inner.complete(req);
      await this.store({ response_id: out.id ?? null, model: out.model, feature, input: out.usage.inputTokens, output: out.usage.outputTokens, success: true, error: null });
      return out;
    } catch (e: any) {
      // A failed call returns no usage, so none is counted; the attempt is still recorded
      await this.store({ response_id: null, model: 'unknown', feature, input: 0, output: 0, success: false, error: String(e?.code ?? 'unexpected').slice(0, 30) });
      throw e;
    }
  }
  private async store(r: { response_id: string | null; model: string; feature: string; input: number; output: number; success: boolean; error: string | null }) {
    const input = Math.max(0, Math.round(Number(r.input) || 0));
    const output = Math.max(0, Math.round(Number(r.output) || 0));
    try {
      await this.db()('assistant_ai_usage').insert({
        response_id: r.response_id ? String(r.response_id).slice(0, 100) : null, provider: this.inner.name, model: String(r.model).slice(0, 60),
        feature: r.feature, input_tokens: input, output_tokens: output, total_tokens: input + output, success: r.success, error_code: r.error, created_at: this.now(),
      });
    } catch (e: any) {
      if (!/unique|duplicate/i.test(String(e?.message))) console.error('[assistant] usage could not be recorded');
    }
  }
}

const istDate = (ms: number) => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
const istDayStart = (date: string) => Date.parse(`${date}T00:00:00+05:30`);

// Totals for today, the last 7 days, this month and all time (IST), a daily series, and totals by feature
export async function usageSummary(db: Knex, now: Date = new Date(), days = 30) {
  const today = istDate(now.getTime());
  const todayStart = istDayStart(today);
  const weekStart = todayStart - 6 * DAY_MS;
  const monthStart = istDayStart(`${today.slice(0, 7)}-01`);
  const seriesStart = todayStart - (days - 1) * DAY_MS;
  const rows = await db('assistant_ai_usage').select('created_at', 'feature', 'model', 'input_tokens', 'output_tokens', 'total_tokens', 'success');
  const empty = () => ({ requests: 0, failed: 0, input: 0, output: 0, total: 0 });
  const periods = { today: empty(), last_7_days: empty(), this_month: empty(), all_time: empty() };
  const series = new Map<string, ReturnType<typeof empty>>();
  for (let i = 0; i < days; i++) series.set(istDate(seriesStart + i * DAY_MS + DAY_MS / 2), empty());
  const byFeature = new Map<string, ReturnType<typeof empty>>(USAGE_FEATURES.map((f) => [f, empty()]));
  const models = new Set<string>();
  let first: number | null = null;
  const add = (a: ReturnType<typeof empty>, r: any) => {
    a.requests++; if (!r.success || r.success === 0) a.failed++;
    a.input += Number(r.input_tokens); a.output += Number(r.output_tokens); a.total += Number(r.total_tokens);
  };
  for (const r of rows) {
    const ms = new Date(r.created_at).getTime();
    if (!Number.isFinite(ms)) continue;
    first = first === null ? ms : Math.min(first, ms);
    if (r.success && r.model !== 'unknown') models.add(String(r.model));
    add(periods.all_time, r);
    if (ms >= monthStart) add(periods.this_month, r);
    if (ms >= weekStart) add(periods.last_7_days, r);
    if (ms >= todayStart) add(periods.today, r);
    const day = series.get(istDate(ms));
    if (day) add(day, r);
    add(byFeature.get(r.feature) ?? byFeature.get('other')!, r);
  }
  const all = periods.all_time;
  const succeeded = all.requests - all.failed;
  return {
    tracking_since: first ? new Date(first).toISOString() : null,
    models: [...models],
    totals: { ...all, average_per_request: succeeded ? Math.round(all.total / succeeded) : 0 },
    periods,
    daily: [...series.entries()].map(([date, v]) => ({ date, ...v })),
    by_feature: [...byFeature.entries()].map(([feature, v]) => ({ feature, ...v })),
  };
}
