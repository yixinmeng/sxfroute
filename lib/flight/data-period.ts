export const FLIGHT_DATA_PERIOD = {
  start: '2026-09-01',
  end: '2026-10-24',
} as const;

export const FLIGHT_DATA_PERIOD_LABEL = '2026年9月1日至10月24日';

export const RESTRICTED_PERIODS_666 = [
  {
    start: '2026-09-30',
    end: '2026-10-09',
    label: '2026年9月30日至10月9日',
  },
] as const;

export function isWithinFlightDataPeriod(date: string): boolean {
  return date >= FLIGHT_DATA_PERIOD.start && date <= FLIGHT_DATA_PERIOD.end;
}
