// The order things happen on a travel day, for the Plan & price day card:
// check-out and the drive to the airport, the flight, the drive from the airport to the
// next lodge or hotel, then that lodge's safaris and extras.
//   0 the stay / notes   1 leaving (to an airport or station)   2 flights
//   3 arriving (from an airport or station) and lodge to lodge drives   4 safaris   5 other items
export const DAY_STEP = { stay: 0, leave: 1, flight: 2, arrive: 3, safari: 4, item: 5, empty: 6 } as const;

const PORT = /\b(airport|railway|station|junction)\b/i;

export function transferStep(fromLabel: string, toLabel: string): number {
  if (PORT.test(toLabel) && !PORT.test(fromLabel)) return DAY_STEP.leave;
  return DAY_STEP.arrive;
}

export function itemStep(item: { type: string }): number {
  return item.type === "flight" ? DAY_STEP.flight : DAY_STEP.item;
}
