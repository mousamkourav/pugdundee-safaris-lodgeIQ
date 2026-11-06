// The fare of a domestic flight in the circuit when Master data > Flight routes has no row for it
// (owner, 5 Nov 2026: every domestic flight is Rs 15,000 per person one way). Sales settings
// "Domestic flight fare" changes it (PricingSettings.flight_fare_pp).
export const DOMESTIC_FLIGHT_FARE = 15_000;

export const flightFare = (settings: { flight_fare_pp?: number | null } | undefined) => {
  const v = Number(settings?.flight_fare_pp);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : DOMESTIC_FLIGHT_FARE;
};
