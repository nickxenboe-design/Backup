# Backend Integration Guide: Busbud + Eagleliner

## Purpose and scope
This document explains **only** the integration layer that lets the Uniglade backend call **Busbud** and **Eagleliner** behind a shared set of Uniglade endpoints.

It is intended to help a developer:
- Understand where each provider is called.
- Understand how upstream responses are normalized into a common shape.
- Safely modify the integration without breaking the other provider.

## High-level architecture
### The "provider switch" pattern
The backend keeps **one public search endpoint**:
- `GET /api/search`

A query parameter determines which upstream provider to call:
- `provider=busbud` (default)
- `provider=eagleliner`

The goal is:
- **Same Uniglade endpoint**, different upstream provider.
- Normalize results into a **compatible trip shape** so the frontend can render both providers together.

## Key backend files (integration only)
- `backend/server.js`
  - Mounts Uniglade routes.
  - Mounts Eagleliner helper routes at `/api/eagleliner`.
- `backend/src/routes/search.js`
  - Implements `GET /api/search`.
  - Switches between Busbud and Eagleliner by `provider`.
- `backend/src/routes/selectTrips.js`
  - Implements `POST /api/trips/select`.
  - **Busbud cart flow**.
  - Explicitly blocks Eagleliner (`tripId` starting with `eagleliner:`).
- `backend/src/services/busbud.service.mjs`
  - Busbud upstream API client + transformations.
- `backend/src/services/eagleliner/*`
  - Eagleliner upstream client and utilities.
  - `eaglelinerClient.js`, `stops.service.js`, `trips.service.js`, `passengerTypes.service.js`, `normalizeTrip.js`.

## Uniglade endpoints exposed (integration-specific)
### 1) Search trips (both providers)
`GET /api/search`

**Query parameters used by integration**
- `origin` (string)
- `destination` (string)
- `date` (YYYY-MM-DD)
- `provider` (`busbud` | `eagleliner`) default `busbud`
- Passenger counts:
  - `adults` (default `1`)
  - `children` (default `0`)
  - `seniors` (default `0`)
  - `students` (default `0`)
- Busbud-only child ages:
  - `age` (comma-separated list, required when `children > 0` and `provider!=eagleliner`)

**Code location**
- `backend/src/routes/search.js`

**Provider-specific behavior**
- **Busbud**
  - Calls `BusbudService.search(origin, destination, date, options)`.
  - May return a `searchId` that requires polling (handled in `BusbudService`).
- **Eagleliner**
  - Calls `searchTripsByCities({ fromCity, toCity, departureDate, passengers })`.
  - Converts passenger counts into `passengers` (total count).
  - Normalizes trips with `normalizeEaglelinerTrip()`.

### 2) Select trip / reserve (Busbud only)
`POST /api/trips/select`

**Code location**
- `backend/src/routes/selectTrips.js`

**Important**
- If `tripId` starts with `eagleliner:` the route returns an error and stops.
  - This is intentional: Eagleliner reservation/booking flow differs and is not implemented here.

### 3) Eagleliner helper endpoint: passenger types
`GET /api/eagleliner/passenger-types`

**Code location**
- Route: `backend/src/routes/eagleliner.js`
- Service: `backend/src/services/eagleliner/passengerTypes.service.js`

**Upstream called**
- `GET /api/v2/passenger/list_types`

**Caching**
- In-memory cache controlled by:
  - `PASSENGER_TYPES_CACHE` (default true)
  - `PASSENGER_TYPES_CACHE_TTL_MS` (default 24h)

## Upstream API calls (what we call externally)
### Busbud upstream endpoints (via `BusbudService`)
The Busbud integration is centralized in `backend/src/services/busbud.service.mjs`.

Common upstream endpoints used by the current booking flow include:
- `POST {BUSBUD_BASE_URL}/searches` (search)
  - Poll URL returned as `metadata.links.poll`.
- `GET  {BUSBUD_BASE_URL}{pollLink}` (poll search results)
- `POST {BUSBUD_BASE_URL}/carts` (create cart)
- `GET  {BUSBUD_BASE_URL}/carts/{cartId}` (fetch cart)
- `POST {BUSBUD_BASE_URL}/carts/{cartId}/trips` (add trip(s) to cart)
- `PUT  {BUSBUD_BASE_URL}/carts/{cartId}/purchaser` (set purchaser)
- `GET  {BUSBUD_BASE_URL}/carts/{cartId}/charges` / `PUT .../charges` (pricing / charges)
- `POST {BUSBUD_BASE_URL}/purchases` (purchase)

Notes:
- The exact Busbud base URL and API version/profile come from backend config (`backend/src/config/index.js`).
- The cart-based approach is a core difference vs Eagleliner.

### Eagleliner upstream endpoints (via `backend/src/services/eagleliner`)
All Eagleliner requests use `createEaglelinerClient()` in:
- `backend/src/services/eagleliner/eaglelinerClient.js`

Upstream endpoints currently used:
- `GET  /api/v2/stops/list` (stop list; cached)
  - Implemented by: `backend/src/services/eagleliner/stops.service.js`
- `POST /api/v2/trips/find` (trip search)
  - Implemented by: `backend/src/services/eagleliner/trips.service.js`
- `GET  /api/v2/passenger/list_types` (passenger types)
  - Implemented by: `backend/src/services/eagleliner/passengerTypes.service.js`

Notes:
- Eagleliner auth uses username + **SHA512(password)**.
- Credentials are injected into every request payload by `buildCredentials()`.

## Normalization (making both providers look similar)
### Why normalization exists
Busbud and Eagleliner return different structures.
The frontend expects a `BusRoute` shape derived from a shared, normalized "trip" object.

### Eagleliner normalization
Code:
- `backend/src/services/eagleliner/normalizeTrip.js`

Key outputs:
- `id`: prefixed with `eagleliner:` so we can identify the provider everywhere.
- `provider: 'eagleliner'`
- `segments`: minimal array with origin/destination/timestamps.
- `prices`: includes a `prices.breakdown.passengers[]` list using Eagleliner `FairPrice`.
- Seat counters:
  - `availableSeats`
  - `reservedSeats`
  - `occupiedSeats`

Fare calculation strategy:
- Eagleliner trip search includes a `FairPrice` list by passenger type.
- Backend passes passenger counts into `normalizeEaglelinerTrip()` so it can compute `price.amount` using type-based units.
- Frontend still recomputes totals for display from the breakdown (defensive / UI-driven).

## Environment variables (integration-related)
### Required for Busbud
- `BUSBUD_PUBLIC_TOKEN` (required; server exits if missing)

### Eagleliner
- `EAGLE_BASE_URL` (default `https://enable.eaglezim.co.za`)
- `EAGLE_USERNAME`
- `EAGLE_PASSWORD`
- `EAGLE_TIMEOUT_MS` (default 30000)
- `EAGLE_OPERATOR_ID` (default `2`)
- `EAGLE_MAX_STOP_PAIRS` (default `25`)
- `EAGLE_STOPS_CACHE_TTL_MS` (default 1h)

### Passenger types caching
- `PASSENGER_TYPES_CACHE` (default true)
- `PASSENGER_TYPES_CACHE_TTL_MS` (default 24h)

## Extension guide (how to modify safely)
When changing integration behavior:
- Keep **provider branching localized** (prefer `search.js` for search behavior).
- Preserve the invariant:
  - Busbud trip IDs are opaque (not prefixed).
  - Eagleliner trip IDs are prefixed with `eagleliner:`.
- If you change Eagleliner normalization fields, also update:
  - `frontend/src/utils/tripMapper.ts`
  - `frontend/src/utils/fareUtils.ts`
  - UI components showing breakdown/seat counters.

## Version history (append-only)
**Rule:** Never delete old entries. Append a new entry at the top.

### 2026-01-11 — v0.1.0
- Added provider switch in `GET /api/search`.
- Added Eagleliner trip normalization with fare breakdown + seat counters.
- Added `GET /api/eagleliner/passenger-types` with caching.
- Blocked Eagleliner in `POST /api/trips/select` (Busbud-only cart flow).
