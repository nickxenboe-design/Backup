import type { BusRoute, SearchQuery } from '@/types';

const CHILD_TOKENS = ['child', 'children', 'youth', 'teen', 'student'];
const ADULT_TOKENS = ['adult', 'adults'];
const SENIOR_TOKENS = ['senior', 'seniors'];
const STUDENT_TOKENS = ['student', 'students'];

export interface PassengerFareBreakdown {
  adultUnit: number;
  childUnit: number;
  adultCount: number;
  childCount: number;
  currency: string;
  hasDetailedBreakdown: boolean;
  lines?: Array<{ key: string; label: string; unit: number; count: number; total: number }>;
}

const classifyPassengerType = (raw: string): 'adult' | 'child' | 'senior' | 'student' | 'other' => {
  const value = (raw || '').toLowerCase();
  if (!value) return 'other';
  if (STUDENT_TOKENS.some((t) => value.includes(t))) return 'student';
  if (CHILD_TOKENS.some((t) => value.includes(t))) return 'child';
  if (ADULT_TOKENS.some((t) => value.includes(t))) return 'adult';
  if (SENIOR_TOKENS.some((t) => value.includes(t))) return 'senior';
  return 'other';
};

const getPassengerCountForKey = (query: SearchQuery, key: string): number => {
  const p: any = query?.passengers || {};
  if (key === 'adult') return Number(p.adults || 0);
  if (key === 'child') return Number(p.children || 0);
  if (key === 'senior') return Number(p.seniors || 0);
  if (key === 'student') return Number(p.students || 0);
  return 0;
};

const extractUnitLinesFromBreakdown = (breakdown: any, query: SearchQuery): Array<{ key: string; label: string; unit: number; count: number; total: number }> => {
  if (!breakdown || typeof breakdown !== 'object') return [];
  const passengers = (breakdown as any).passengers;
  if (!Array.isArray(passengers) || passengers.length === 0) return [];

  const unitByKey = new Map<string, { label: string; unit: number }>();
  for (const p of passengers) {
    if (!p || typeof p !== 'object') continue;
    const passenger: any = p;
    const label = String(
      passenger.category ||
      passenger.passengerType ||
      passenger.passenger_type ||
      passenger.type ||
      passenger.name ||
      ''
    ).trim();
    const key = classifyPassengerType(label);
    if (key === 'other') continue;

    const unit = Number(
      passenger.unit ??
      passenger.price ??
      passenger.amount ??
      passenger.total
    );
    if (!Number.isFinite(unit) || unit <= 0) continue;

    if (!unitByKey.has(key)) {
      unitByKey.set(key, { label: label || key, unit });
    }
  }

  const lines: Array<{ key: string; label: string; unit: number; count: number; total: number }> = [];
  for (const key of ['adult', 'child', 'senior', 'student']) {
    const found = unitByKey.get(key);
    if (!found) continue;
    const count = getPassengerCountForKey(query, key);
    if (!count || count <= 0) continue;
    lines.push({ key, label: found.label, unit: found.unit, count, total: found.unit * count });
  }
  return lines;
};

const resolveScalingFromTotals = (route: BusRoute, prices: any[]): number => {
  const basePrice = route.price || 0;
  if (!basePrice) return 1;

  for (const entry of prices) {
    if (!entry) continue;
    const anyEntry: any = entry;
    const p = anyEntry.prices;
    const b = anyEntry.breakdown;

    const candidates: Array<any> = [];
    if (p && p.total != null) candidates.push(p.total);
    if (p && p.breakdown && p.breakdown.total != null) candidates.push(p.breakdown.total);
    if (b && b.total != null) candidates.push(b.total);

    for (const candidate of candidates) {
      const num = Number(candidate);
      if (!num || !Number.isFinite(num)) continue;
      const scaling = basePrice / num;
      if (scaling > 0 && Number.isFinite(scaling)) {
        return scaling;
      }
    }
  }

  return 1;
};

interface BreakdownTotalsResult {
  adultTotal: number;
  childTotal: number;
  adultCount: number;
  childCount: number;
  hasAny: boolean;
}

const extractTotalsFromBreakdown = (breakdown: any, scaling: number): BreakdownTotalsResult => {
  let adultTotal = 0;
  let childTotal = 0;
  let adultCount = 0;
  let childCount = 0;
  let hasAny = false;

  if (!breakdown || typeof breakdown !== 'object') {
    return { adultTotal, childTotal, adultCount, childCount, hasAny };
  }

  for (const [rawKey, rawValue] of Object.entries(breakdown)) {
    const key = rawKey.toLowerCase();

    if (key === 'passengers' && Array.isArray(rawValue)) {
      for (const p of rawValue) {
        if (!p || typeof p !== 'object') continue;
        const passenger: any = p;

        const pTypeField = String(
          passenger.category ||
          passenger.passengerType ||
          passenger.passenger_type ||
          passenger.type ||
          ''
        );
        const pType = classifyPassengerType(pTypeField);
        if (pType === 'other') continue;

        let rawTotal: number | null = null;
        let count = 0;

        if (passenger.total != null) {
          rawTotal = Number(passenger.total);
        } else if (passenger.breakdown && passenger.breakdown.total != null) {
          rawTotal = Number(passenger.breakdown.total);
        } else if (passenger.breakdown && passenger.breakdown.base != null) {
          rawTotal = Number(passenger.breakdown.base);
        } else if (passenger.amount != null) {
          rawTotal = Number(passenger.amount);
        }

        if (passenger.count != null && Number.isFinite(Number(passenger.count))) {
          count = Number(passenger.count);
        }

        if (rawTotal == null || !Number.isFinite(rawTotal)) continue;

        const majorTotal = rawTotal * scaling;
        if (count <= 0) count = 1;

        hasAny = true;

        if (pType === 'adult') {
          adultTotal += majorTotal;
          adultCount += count;
        } else if (pType === 'child') {
          childTotal += majorTotal;
          childCount += count;
        }
      }
      continue;
    }

    if (key === 'total' || key === 'tax' || key === 'taxes' || key === 'fee' || key === 'fees') {
      continue;
    }

    let type = classifyPassengerType(key);

    if (type === 'other' && rawValue && typeof rawValue === 'object') {
      const nested: any = rawValue;
      const nestedTypeField = String(
        nested.passengerType ||
        nested.passenger_type ||
        nested.type ||
        nested.category ||
        ''
      );
      const nestedType = classifyPassengerType(nestedTypeField);
      if (nestedType !== 'other') {
        type = nestedType;
      }
    }

    if (type === 'other') continue;

    let rawTotal: number | null = null;
    let count = 0;

    if (typeof rawValue === 'number') {
      rawTotal = rawValue;
    } else if (rawValue && typeof rawValue === 'object') {
      const node: any = rawValue;
      if (node.total != null) {
        rawTotal = Number(node.total);
      } else if (node.amount != null) {
        rawTotal = Number(node.amount);
      }
      if (node.count != null && Number.isFinite(Number(node.count))) {
        count = Number(node.count);
      }
    }

    if (rawTotal == null || !Number.isFinite(rawTotal)) continue;

    const majorTotal = rawTotal * scaling;
    if (count <= 0) count = 1;

    hasAny = true;

    if (type === 'adult') {
      adultTotal += majorTotal;
      adultCount += count;
    } else if (type === 'child') {
      childTotal += majorTotal;
      childCount += count;
    }
  }

  return { adultTotal, childTotal, adultCount, childCount, hasAny };
};

export const computePassengerFareBreakdown = (route: BusRoute, query: SearchQuery): PassengerFareBreakdown => {
  const totalAdults = query.passengers?.adults || 0;
  const totalChildren = query.passengers?.children || 0;
  const totalSeniors = Number((query.passengers as any)?.seniors || 0);
  const totalStudents = Number((query.passengers as any)?.students || 0);
  const travelerCount = Math.max(1, totalAdults + totalChildren + totalSeniors + totalStudents);
  const basePrice = route.price || 0;
  const defaultUnit = travelerCount > 0 ? basePrice / travelerCount : 0;
  const currency = route.currency || 'USD';

  let adultUnit = defaultUnit;
  let childUnit = defaultUnit;
  let adultCount = totalAdults;
  let childCount = totalChildren;
  let hasDetailedBreakdown = false;

  const rawPrices: any[] = (route as any)?.prices;
  if (Array.isArray(rawPrices) && rawPrices.length > 0) {
    for (const entry of rawPrices) {
      if (!entry) continue;
      const anyEntry: any = entry;
      const breakdown = anyEntry?.prices?.breakdown || anyEntry?.breakdown;
      const lines = extractUnitLinesFromBreakdown(breakdown, query);
      if (lines.length > 0) {
        const findUnit = (k: string) => lines.find((l) => l.key === k)?.unit;
        adultUnit = findUnit('adult') ?? adultUnit;
        childUnit = findUnit('child') ?? childUnit;
        hasDetailedBreakdown = true;
        return {
          adultUnit,
          childUnit,
          adultCount: totalAdults,
          childCount: totalChildren,
          currency,
          hasDetailedBreakdown,
          lines,
        };
      }
    }

    const scaling = resolveScalingFromTotals(route, rawPrices);

    let adultTotal = 0;
    let childTotal = 0;
    let adultCountFromBreak = 0;
    let childCountFromBreak = 0;

    for (const entry of rawPrices) {
      if (!entry) continue;
      const anyEntry: any = entry;

      let handled = false;

      if (anyEntry.prices && anyEntry.prices.breakdown) {
        const res = extractTotalsFromBreakdown(anyEntry.prices.breakdown, scaling);
        adultTotal += res.adultTotal;
        childTotal += res.childTotal;
        adultCountFromBreak += res.adultCount;
        childCountFromBreak += res.childCount;
        if (res.hasAny) hasDetailedBreakdown = true;
        handled = true;
      } else if (anyEntry.breakdown) {
        const res = extractTotalsFromBreakdown(anyEntry.breakdown, scaling);
        adultTotal += res.adultTotal;
        childTotal += res.childTotal;
        adultCountFromBreak += res.adultCount;
        childCountFromBreak += res.childCount;
        if (res.hasAny) hasDetailedBreakdown = true;
        handled = true;
      }

      if (!handled) {
        const typeField = String(
          anyEntry.passengerType ||
          anyEntry.passenger_type ||
          anyEntry.type ||
          anyEntry.category ||
          ''
        );
        const simpleType = classifyPassengerType(typeField);
        if (simpleType !== 'other') {
          let rawTotal: number | null = null;
          let count = 0;

          if (anyEntry.total != null) {
            rawTotal = Number(anyEntry.total);
          } else if (anyEntry.amount != null) {
            rawTotal = Number(anyEntry.amount);
          } else if (anyEntry.price && anyEntry.price.amount != null) {
            rawTotal = Number(anyEntry.price.amount);
          } else if (anyEntry.fare && anyEntry.fare.total != null) {
            rawTotal = Number(anyEntry.fare.total);
          }

          if (anyEntry.count != null && Number.isFinite(Number(anyEntry.count))) {
            count = Number(anyEntry.count);
          }

          if (rawTotal != null && Number.isFinite(rawTotal)) {
            const majorTotal = rawTotal * scaling;
            if (count <= 0) count = 1;
            hasDetailedBreakdown = true;

            if (simpleType === 'adult') {
              adultTotal += majorTotal;
              adultCountFromBreak += count;
            } else if (simpleType === 'child') {
              childTotal += majorTotal;
              childCountFromBreak += count;
            }
          }
        }
      }
    }

    if (hasDetailedBreakdown) {
      if (adultCountFromBreak > 0) {
        adultUnit = adultTotal / adultCountFromBreak;
        adultCount = totalAdults || adultCountFromBreak;
      }
      if (childCountFromBreak > 0) {
        childUnit = childTotal / childCountFromBreak;
        childCount = totalChildren || childCountFromBreak;
      }
    }
  }

  return {
    adultUnit,
    childUnit,
    adultCount,
    childCount,
    currency,
    hasDetailedBreakdown,
  };
};
