// Pulls the REAL spend-to-date from each provider's billing API for the current
// month, instead of relying solely on our own per-call cost estimate. Neither
// Anthropic nor OpenAI exposes a "remaining prepaid credit" balance via API —
// that figure only exists in their billing console UI, typed in by a human —
// so the "crédito total" still comes from ai_billing_settings. This module only
// replaces the "gasto" (spend) side with the provider's own ledger when an Admin
// API key is configured; otherwise callers should fall back to the local estimate.

const ANTHROPIC_VERSION = '2023-06-01';

// Anthropic Cost Report: amount is a decimal string in the lowest currency unit
// (cents) — "123.45" means $1.2345 (not $123.45).
// https://platform.claude.com/docs/en/api/admin-api/usage-cost/get-cost-report
export async function fetchAnthropicCostUsd(
  adminApiKey: string,
  startingAt: Date,
  endingAt: Date,
): Promise<number | null> {
  try {
    let total = 0;
    let page: string | undefined;
    let guard = 0;
    do {
      const url = new URL('https://api.anthropic.com/v1/organizations/cost_report');
      url.searchParams.set('starting_at', startingAt.toISOString());
      url.searchParams.set('ending_at', endingAt.toISOString());
      url.searchParams.set('limit', '31');
      if (page) url.searchParams.set('page', page);

      const res = await fetch(url.toString(), {
        headers: { 'anthropic-version': ANTHROPIC_VERSION, 'x-api-key': adminApiKey },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const json = await res.json() as {
        data?: Array<{ results?: Array<{ amount?: string }> }>;
        has_more?: boolean;
        next_page?: string;
      };
      for (const bucket of json.data ?? []) {
        for (const r of bucket.results ?? []) {
          total += (parseFloat(r.amount ?? '0') || 0) / 100;
        }
      }
      page = json.has_more ? json.next_page : undefined;
      guard++;
    } while (page && guard < 10);
    return total;
  } catch {
    return null;
  }
}

// OpenAI Costs API: amount.value is already in actual currency units (dollars), not cents.
// https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs
export async function fetchOpenAiCostUsd(
  adminApiKey: string,
  startingAt: Date,
  endingAt: Date,
): Promise<number | null> {
  try {
    let total = 0;
    let page: string | undefined;
    let guard = 0;
    do {
      const url = new URL('https://api.openai.com/v1/organization/costs');
      url.searchParams.set('start_time', String(Math.floor(startingAt.getTime() / 1000)));
      url.searchParams.set('end_time', String(Math.floor(endingAt.getTime() / 1000)));
      url.searchParams.set('limit', '180');
      if (page) url.searchParams.set('page', page);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${adminApiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const json = await res.json() as {
        data?: Array<{ results?: Array<{ amount?: { value?: number } }> }>;
        has_more?: boolean;
        next_page?: string | null;
      };
      for (const bucket of json.data ?? []) {
        for (const r of bucket.results ?? []) {
          total += r.amount?.value ?? 0;
        }
      }
      page = json.has_more ? (json.next_page ?? undefined) : undefined;
      guard++;
    } while (page && guard < 10);
    return total;
  } catch {
    return null;
  }
}
