# Frontend Integration Guide: Busbud + Eagleliner

## Purpose and scope
This document covers the **frontend-side integration layer** that enables:
- Calling the same Uniglade backend endpoints for **Busbud** and **Eagleliner**.
- Showing trips from both providers in one UI.
- Handling provider-specific selection behavior (Busbud reserves via `/api/trips/select`, Eagleliner does not).

It is not a full system guide; it focuses on the **two-provider integration**.

## High-level flow
### Search
1. Frontend searches Busbud first:
   - `searchTrips({ ...query, provider: 'busbud' })`
2. Then (one-way searches only), it fetches Eagleliner in the background:
   - `searchTrips({ ...query, provider: 'eagleliner', returnDate: undefined })`
3. Results are merged and deduped by `route.id`.

### Select trip
- **Busbud trips**:
  - Selecting a trip triggers `selectTrip()` (backend `POST /api/trips/select`) to create a cart and reserve the trip.
- **Eagleliner trips**:
  - Selecting a trip does **not** call `selectTrip()`.
  - The UI opens the confirmation modal directly and uses the search response fare breakdown and seat counters.

## Key frontend files (integration only)
- `frontend/App.tsx`
  - Orchestrates sequential provider searches and merges results.
- `frontend/src/utils/api.ts`
  - `searchTrips()` adds `provider` to the `/api/search` query.
  - Holds selection calls (`selectTrip`, etc.) for Busbud.
- `frontend/src/utils/tripMapper.ts`
  - Maps raw backend trip payload into `BusRoute`.
  - Passes through `provider`, `availableSeats`, `reservedSeats`, `occupiedSeats`.
- `frontend/src/components/Results.tsx`
  - Renders list of trips.
  - For Eagleliner trips, passes `deferApiCall` to avoid reserve/select.
- `frontend/src/components/BusSearchResults.tsx`
  - Same bypass behavior for its list rendering.
- `frontend/src/components/BusResultCard.tsx`
  - If `deferApiCall` is true, selecting calls `onTripSelected(route)` directly.
  - Otherwise it calls `selectTrip(...)`.
- `frontend/src/components/ConfirmationModal.tsx`
  - UI copy differs for Eagleliner (no reservation release copy).
- `frontend/src/components/TripSummary.tsx`
  - Displays seat counters and fare breakdown.
- `frontend/src/utils/fareUtils.ts`
  - Computes a client-side fare breakdown from normalized `prices`.

## Backend endpoints the frontend calls
### 1) Search
`GET /api/search`

Implemented in frontend by:
- `searchTrips()` in `frontend/src/utils/api.ts`

Important request behavior:
- Sends `provider` (`busbud` or `eagleliner`).
- Sends passenger counts: `adults`, `children`, optional `seniors`, `students`.
- Sends child ages (`age=`) only when `childrenAges` exist (mainly Busbud).

### 2) Busbud trip selection (reserve/cart)
`POST /api/trips/select`

Triggered from:
- `BusResultCard.tsx` when `deferApiCall === false`.

Important:
- This is a Busbud-only endpoint in current integration.

### 3) Eagleliner passenger types (optional helper)
`GET /api/eagleliner/passenger-types`

Current UI behavior:
- **Not required for totals** if Eagleliner search results already contain `FairPrice`.
- Can be used in future to validate available passenger types or build a type picker.

## Provider detection
The current integration uses a simple invariant:
- `route.id.startsWith('eagleliner:')` means Eagleliner.

This is used to:
- Bypass `selectTrip()`.
- Render seat counters and fare breakdown from Eagleliner data.

## Data normalization in the UI
### `BusRoute` fields used for integration
From `frontend/src/types.ts`:
- `provider?: string`
- `availableSeats?: number`
- `reservedSeats?: number`
- `occupiedSeats?: number`
- `prices?: any[]`

Mapping is done in:
- `frontend/src/utils/tripMapper.ts`

### Fare breakdown calculation
Code:
- `frontend/src/utils/fareUtils.ts` (`computePassengerFareBreakdown`)

Inputs:
- Uses `route.prices[*].prices.breakdown.passengers[]` when present.
- For Eagleliner, these are **unit prices by passenger type** (derived from `FairPrice`).

Output:
- Returns `hasDetailedBreakdown` and optional `lines[]`.
- `TripSummary.tsx` renders `lines[]` when present.

Passenger counts:
- Fare computation considers `adults`, `children`, `seniors`, `students`.

### Seat counters
Displayed in:
- `TripSummary.tsx`

Fields:
- `availableSeats`, `reservedSeats`, `occupiedSeats`

Note:
- Seat map visualization is not implemented yet; only counters are shown.

## Search merge/dedupe behavior
Where:
- `App.tsx` merges Busbud + Eagleliner by `id`.

Important:
- Eagleliner is fetched **only** for one-way searches (`tripType === 'one-way'`).
- This avoids mixing provider logic into a Busbud round-trip cart flow.

## Extension guide (how to modify safely)
When you change integration behavior:
- Keep provider branching explicit:
  - Do not accidentally call `selectTrip()` for Eagleliner.
- If you change the Eagleliner normalized trip shape, update:
  - `tripMapper.ts` (pass-through fields)
  - `fareUtils.ts` (breakdown parsing)
  - UI components showing breakdown/seat counters.

## Version history (append-only)
**Rule:** Never delete old entries. Append a new entry at the top.

### 2026-01-11 — v0.1.0
- Sequential search in `App.tsx`: Busbud first, then Eagleliner (one-way only).
- Eagleliner selection bypasses `selectTrip()` using `deferApiCall`.
- Confirmation modal + trip summary show Eagleliner fare breakdown and seat counters.
