export type DataQualityIssueType =
  | 'duplicate_trip'
  | 'operator_missing'
  | 'operator_truncated'
  | 'origin_invalid'
  | 'destination_invalid'
  | 'departure_time_invalid'
  | 'arrival_time_invalid'
  | 'duration_invalid';

export type DataQualitySeverity = 'warning' | 'error';

export type DataQualityIssue = {
  type: DataQualityIssueType;
  severity: DataQualitySeverity;
  message: string;
  routeId?: string;
};

type BusRouteLite = {
  id: string;
  tripId?: string;
  journey_id?: string;
  busCompany: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  price: number;
  amenities: string[];
  operator?: string;
  availableSeats?: number;
  legs?: any[];
  [k: string]: unknown;
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

export const isPlaceholder = (value: string) => {
  const v = normalizeWhitespace(value || '').toLowerCase();
  if (!v) return true;
  if (v === 'n/a' || v === 'na') return true;
  if (v.includes('unknown')) return true;
  if (v === 'undefined' || v === 'null') return true;
  return false;
};

export const normalizeOperatorName = (value: string) => {
  const raw = normalizeWhitespace(value || '');
  return raw;
};

const normalizeOperatorKey = (value: string) => {
  const raw = normalizeWhitespace(value || '');
  return raw.replace(/[.…]+$/g, '').trim();
};

export const normalizeLocationName = (value: string) => {
  return normalizeWhitespace(value || '');
};

export const isTruncatedName = (value: string) => {
  const v = normalizeWhitespace(value || '');
  return v.endsWith('...') || v.endsWith('…');
};

export const isInvalidLocationName = (value: string) => {
  const v = normalizeLocationName(value || '');
  if (isPlaceholder(v)) return true;
  if (/^\d+$/.test(v)) return true;
  return false;
};

const pickBestOperatorName = (busCompany: unknown, operator: unknown) => {
  const a = typeof busCompany === 'string' ? normalizeOperatorName(busCompany) : '';
  const b = typeof operator === 'string' ? normalizeOperatorName(operator) : '';

  const aOk = !!a && !isPlaceholder(a);
  const bOk = !!b && !isPlaceholder(b);

  if (!aOk && !bOk) return '';
  if (aOk && !bOk) return a;
  if (!aOk && bOk) return b;

  const aTrunc = isTruncatedName(a);
  const bTrunc = isTruncatedName(b);

  if (aTrunc && !bTrunc) return b;
  if (!aTrunc && bTrunc) return a;

  return a.length >= b.length ? a : b;
};

const normalizeTimeToken = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  return normalizeWhitespace(value);
};

const computeTripFingerprint = (route: BusRouteLite) => {
  const company = normalizeOperatorKey(route.busCompany || route.operator || '');
  const stableId = normalizeWhitespace(String(route.tripId || route.journey_id || '')).toLowerCase();
  const origin = normalizeLocationName(route.origin || '');
  const destination = normalizeLocationName(route.destination || '');
  const departureTime = normalizeTimeToken(route.departureTime);
  const arrivalTime = normalizeTimeToken(route.arrivalTime);
  const duration = normalizeWhitespace(route.duration || '');
  const price = typeof route.price === 'number' && Number.isFinite(route.price) ? Math.round(route.price * 100) : 0;

  if (stableId && stableId !== 'unknown') {
    return ['id', company.toLowerCase(), stableId, departureTime, arrivalTime].join('|');
  }

  return ['heur', company.toLowerCase(), origin.toLowerCase(), destination.toLowerCase(), departureTime, arrivalTime, duration, String(price)].join('|');
};

export type DataQualityOperatorStat = {
  name: string;
  tripCount: number;
  issueCount: number;
  sampleTripIds: string[];
};

export type AnalyzeBusRoutesResult = {
  routes: BusRouteLite[];
  duplicatesHiddenCount: number;
  issues: DataQualityIssue[];
  operatorStats: DataQualityOperatorStat[];
};

export const analyzeBusRoutes = (routes: BusRouteLite[]): AnalyzeBusRoutesResult => {
  const issues: DataQualityIssue[] = [];

  const normalizedRoutes = routes.map((r) => {
    const rawCompany = pickBestOperatorName(r.busCompany, r.operator);
    const rawOrigin = normalizeLocationName(r.origin || '');
    const rawDestination = normalizeLocationName(r.destination || '');

    const originInvalid = isInvalidLocationName(rawOrigin);
    const destinationInvalid = isInvalidLocationName(rawDestination);

    const dep = normalizeTimeToken(r.departureTime);
    const arr = normalizeTimeToken(r.arrivalTime);
    const duration = normalizeWhitespace(r.duration || '');

    const depInvalid = isPlaceholder(dep);
    const arrInvalid = isPlaceholder(arr);
    const durationInvalid = isPlaceholder(duration);

    const companyMissing = !rawCompany || isPlaceholder(rawCompany);
    const normalizedCompany = companyMissing ? 'Unknown Operator' : rawCompany;

    const next: BusRouteLite = {
      ...r,
      busCompany: normalizedCompany,
      origin: originInvalid ? 'Unknown Origin' : (rawOrigin || r.origin),
      destination: destinationInvalid ? 'Unknown Destination' : (rawDestination || r.destination),
      departureTime: depInvalid ? 'N/A' : (dep || r.departureTime),
      arrivalTime: arrInvalid ? 'N/A' : (arr || r.arrivalTime),
      duration: durationInvalid ? 'N/A' : (duration || r.duration),
    };

    if (companyMissing) {
      issues.push({
        type: 'operator_missing',
        severity: 'error',
        message: 'Missing operator name',
        routeId: r.id,
      });
    }

    if (isTruncatedName(String(r.busCompany || '')) || isTruncatedName(String(r.operator || ''))) {
      issues.push({
        type: 'operator_truncated',
        severity: 'warning',
        message: 'Operator name appears truncated',
        routeId: r.id,
      });
    }

    if (originInvalid) {
      issues.push({
        type: 'origin_invalid',
        severity: 'warning',
        message: `Invalid origin: ${String(r.origin || '')}`,
        routeId: r.id,
      });
    }

    if (destinationInvalid) {
      issues.push({
        type: 'destination_invalid',
        severity: 'warning',
        message: `Invalid destination: ${String(r.destination || '')}`,
        routeId: r.id,
      });
    }

    if (depInvalid) {
      issues.push({
        type: 'departure_time_invalid',
        severity: 'warning',
        message: 'Invalid departure time',
        routeId: r.id,
      });
    }

    if (arrInvalid) {
      issues.push({
        type: 'arrival_time_invalid',
        severity: 'warning',
        message: 'Invalid arrival time',
        routeId: r.id,
      });
    }

    if (durationInvalid) {
      issues.push({
        type: 'duration_invalid',
        severity: 'warning',
        message: 'Invalid duration',
        routeId: r.id,
      });
    }

    return next;
  });

  const seen = new Map<string, string>();
  const deduped: BusRouteLite[] = [];
  let duplicatesHiddenCount = 0;

  for (const r of normalizedRoutes) {
    const key = computeTripFingerprint(r);
    const existing = seen.get(key);
    if (existing) {
      duplicatesHiddenCount += 1;
      issues.push({
        type: 'duplicate_trip',
        severity: 'warning',
        message: `Duplicate trip detected (same as ${existing})`,
        routeId: r.id,
      });
      continue;
    }
    seen.set(key, r.id);
    deduped.push(r);
  }

  const operatorMap = new Map<string, { displayName: string; tripCount: number; issueCount: number; sampleTripIds: string[] }>();
  for (const r of deduped) {
    const displayName = normalizeOperatorName(r.busCompany || r.operator || '') || 'Unknown Operator';
    const k = displayName.toLowerCase();
    const stat = operatorMap.get(k) || { displayName, tripCount: 0, issueCount: 0, sampleTripIds: [] };
    stat.tripCount += 1;
    if (stat.sampleTripIds.length < 3) stat.sampleTripIds.push(r.id);
    operatorMap.set(k, stat);
  }

  for (const issue of issues) {
    if (!issue.routeId) continue;
    const route = deduped.find((r) => r.id === issue.routeId) || normalizedRoutes.find((r) => r.id === issue.routeId);
    const displayName = normalizeOperatorName(route?.busCompany || (route as any)?.operator || '') || 'Unknown Operator';
    const k = displayName.toLowerCase();
    const stat = operatorMap.get(k) || { displayName, tripCount: 0, issueCount: 0, sampleTripIds: [] };
    stat.issueCount += 1;
    operatorMap.set(k, stat);
  }

  const operatorStats: DataQualityOperatorStat[] = Array.from(operatorMap.entries())
    .map(([k, v]) => ({
      name: v.displayName,
      tripCount: v.tripCount,
      issueCount: v.issueCount,
      sampleTripIds: v.sampleTripIds,
    }))
    .sort((a, b) => b.issueCount - a.issueCount);

  return { routes: deduped, duplicatesHiddenCount, issues, operatorStats };
};
