// Live exchange rates for quoting in other currencies: the European Central
// Bank's daily reference rates via the free Frankfurter service (no key needed).
// Cached for 6 hours. If the service cannot be reached, the rates saved in Sales
// settings are used instead. A saved quote keeps the rate it was priced with.

export const QUOTE_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD"] as const;
export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number];

export interface LiveFx {
  rates: Partial<Record<QuoteCurrency, number>>; // rupees per 1 unit
  date: string; // the ECB publication date
}

export async function liveFx(): Promise<LiveFx | null> {
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=INR&symbols=USD,EUR,GBP,AUD", {
      next: { revalidate: 6 * 60 * 60 },
      signal: AbortSignal.timeout(4000),
    } as RequestInit);
    if (!res.ok) return null;
    const j = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const rates: LiveFx["rates"] = {};
    for (const c of ["USD", "EUR", "GBP", "AUD"] as const) {
      const perInr = j.rates?.[c];
      if (perInr && perInr > 0) rates[c] = Math.round((1 / perInr) * 100) / 100; // e.g. 1 USD = 88.42 INR
    }
    return Object.keys(rates).length ? { rates, date: j.date ?? "" } : null;
  } catch {
    return null; // offline or slow: fall back to the saved rates
  }
}
