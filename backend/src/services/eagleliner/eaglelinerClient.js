import axios from 'axios';
import { createHash } from 'crypto';

function truthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIso(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

const mockState = {
  reservations: new Map(),
  tickets: new Map(),
};

function mockStops() {
  return [
    { id: 1, city: 'Harare', name: 'Harare' },
    { id: 2, city: 'Bulawayo', name: 'Bulawayo' },
    { id: 3, city: 'Johannesburg', name: 'Johannesburg' },
    { id: 4, city: 'Pretoria', name: 'Pretoria' },
  ];
}

function stopById(id) {
  const n = Number(id);
  return mockStops().find((s) => Number(s.id) === n) || { id: n, city: String(id), name: String(id) };
}

function buildMockTrip({ depStopId, destStopId, date, pax, operatorId }) {
  const dep = stopById(depStopId);
  const dest = stopById(destStopId);
  const baseDate = (() => {
    const raw = String(date || '').trim();
    if (!raw) return new Date();
    const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();

  const tripId = Number(`${Number(depStopId || 0)}${Number(destStopId || 0)}${baseDate.getUTCDate()}${Number(operatorId || 2)}`) || Math.floor(Date.now() / 1000);
  const depTime = new Date(baseDate.getTime() + 8 * 60 * 60 * 1000);
  const arrTime = new Date(depTime.getTime() + 6 * 60 * 60 * 1000);

  const unit = 25 + (Number(depStopId || 0) % 5) * 5 + (Number(destStopId || 0) % 3) * 3;
  const fairPrice = [
    { name: 'Adult', price: unit },
    { name: 'Child', price: Math.max(1, Math.round(unit * 0.7)) },
    { name: 'Student', price: Math.max(1, Math.round(unit * 0.85)) },
    { name: 'Senior', price: Math.max(1, Math.round(unit * 0.8)) },
  ];

  const availableSeats = 40;
  return {
    TripID: tripId,
    OperatorFilterID: Number(operatorId || 2),
    Operator: 'Eagleliner Coaches',
    RouteName: `${dep.city} -> ${dest.city}`,
    DepartureStopID: Number(dep.id),
    DepartureStopName: dep.name || dep.city,
    DestinationStopID: Number(dest.id),
    DestinationStopName: dest.name || dest.city,
    DepartureTime: toIso(depTime),
    ArrivalTime: toIso(arrTime),
    Passengers: Number(pax || 1),
    FairPrice: fairPrice,
    reserved_seats_no: 0,
    occupied_seats_no: 0,
    available_seats_no: availableSeats,
    available_seats: Array.from({ length: availableSeats }, (_, i) => String(i + 1)),
  };
}

function sha512(value) {
  return createHash('sha512').update(String(value || ''), 'utf8').digest('hex');
}

function buildCredentials({ username, password }) {
  const resolvedUsername = username || process.env.EAGLE_USERNAME;
  const resolvedPassword = password || process.env.EAGLE_PASSWORD;

  if (!resolvedUsername || !resolvedPassword) {
    const err = new Error(
      'Missing Eagleliner credentials. Set EAGLE_USERNAME and EAGLE_PASSWORD in backend .env (or provide username/password explicitly).'
    );
    err.statusCode = 500;
    throw err;
  }

  return {
    Credentials: {
      username: resolvedUsername,
      password: sha512(resolvedPassword),
    },
  };
}

export function createEaglelinerClient() {
  const mockEnabled = truthyEnv(process.env.EAGLELINER_MOCK);

  if (mockEnabled) {
    async function request({ method, path, data }) {
      const m = String(method || '').toUpperCase();
      const p = String(path || '');

      if (m === 'GET' && p === '/api/v2/stops/list') {
        return { Success: true, Stops: mockStops() };
      }

      if (m === 'GET' && p === '/api/v2/passenger/list_types') {
        return {
          Success: true,
          PassengerTypes: [
            { TypeID: 1, Name: 'Adult' },
            { TypeID: 2, Name: 'Child' },
            { TypeID: 3, Name: 'Student' },
            { TypeID: 4, Name: 'Senior' },
          ],
        };
      }

      if (m === 'POST' && p === '/api/v2/trips/find') {
        const trip1 = data && data.TripDetails && data.TripDetails.Trip1 ? data.TripDetails.Trip1 : {};
        const depStopId = trip1.DepartureStopID;
        const destStopId = trip1.DestinationStopID;
        const depDate = trip1.DepartureDate;
        const pax = trip1.Passengers || 1;
        const opFilter = trip1.OperatorFilterID || 2;
        const base = buildMockTrip({ depStopId, destStopId, date: depDate, pax, operatorId: opFilter });
        const later = (() => {
          const dt = new Date(String(base.DepartureTime || '').replace(' ', 'T'));
          const shifted = Number.isNaN(dt.getTime()) ? new Date(Date.now() + 10 * 60 * 60 * 1000) : new Date(dt.getTime() + 3 * 60 * 60 * 1000);
          const end = new Date(shifted.getTime() + 6 * 60 * 60 * 1000);
          return {
            ...base,
            TripID: Number(base.TripID) + 1,
            DepartureTime: toIso(shifted),
            ArrivalTime: toIso(end),
          };
        })();

        return { Success: true, AvailableTrips: { Trip1: [base, later] } };
      }

      if (m === 'POST' && p === '/api/v2/trips/reserve_seats') {
        const trip1 = data && data.TripReservationDetails && data.TripReservationDetails.Trip1 ? data.TripReservationDetails.Trip1 : {};
        const reservationId = `MOCK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const leaseSeconds = 15 * 60;
        const passengers = Number(trip1.Passengers || 1);
        const details = Array.isArray(trip1.PassengerDetails) ? trip1.PassengerDetails : [];
        mockState.reservations.set(String(reservationId), {
          reservationId: String(reservationId),
          createdAtMs: Date.now(),
          leaseSeconds,
          status: 'reserved',
          trip: {
            tripId: trip1.TripID,
            departureStopId: trip1.DepartureStopID,
            destinationStopId: trip1.DestinationStopID,
            departureDate: trip1.DepartureDate,
          },
          passengers,
          passengerDetails: details,
        });

        return {
          Success: true,
          ReservationID: reservationId,
          ReservationLeaseTime: leaseSeconds,
          Message: 'Reservation created (mock)',
        };
      }

      if (m === 'POST' && p === '/api/v2/reservation/make_payment') {
        const id = String((data && (data.ReservationID || data.reservationId)) || '').trim();
        const r = mockState.reservations.get(id) || null;
        if (!r) {
          return { Success: false, Error: 'Reservation not found' };
        }
        const expiresAtMs = Number(r.createdAtMs || 0) + Number(r.leaseSeconds || 0) * 1000;
        if (Date.now() > expiresAtMs) {
          return { Success: false, Error: 'Reservation expired' };
        }
        r.status = 'paid';
        r.paidAtMs = Date.now();
        mockState.reservations.set(id, r);
        return {
          Success: true,
          ReservationID: id,
          AmountReceived: data && data.AmountReceived,
          PaymentMethod: data && data.PaymentMethod,
          Message: 'Payment accepted (mock)',
        };
      }

      if (m === 'POST' && p === '/api/v2/reservation/cancel_reservation') {
        const id = String((data && (data.ReservationID || data.reservationId)) || '').trim();
        const r = mockState.reservations.get(id) || null;
        if (r) {
          r.status = 'cancelled';
          r.cancelledAtMs = Date.now();
          mockState.reservations.set(id, r);
        }
        return { Success: true, ReservationID: id, Message: 'Reservation cancelled (mock)' };
      }

      if (m === 'POST' && p === '/api/v2/reservation/print_tickets') {
        const id = String((data && (data.ReservationID || data.reservationId)) || '').trim();
        const r = mockState.reservations.get(id) || null;
        if (!r) {
          return { Success: false, Error: 'Reservation not found' };
        }
        const expiresAtMs = Number(r.createdAtMs || 0) + Number(r.leaseSeconds || 0) * 1000;
        if (Date.now() > expiresAtMs && r.status !== 'paid') {
          return { Success: false, Error: 'Reservation expired' };
        }

        const depStop = stopById(r.trip && r.trip.departureStopId);
        const destStop = stopById(r.trip && r.trip.destinationStopId);
        const baseDate = String((r.trip && r.trip.departureDate) || '').trim();
        const depDt = baseDate ? `${baseDate}T08:00:00.000Z` : toIso(new Date());
        const arrDt = baseDate ? `${baseDate}T14:00:00.000Z` : toIso(new Date(Date.now() + 6 * 60 * 60 * 1000));

        const details = Array.isArray(r.passengerDetails) ? r.passengerDetails : [];
        const count = Math.max(1, Number(r.passengers || details.length || 1));
        const prev = mockState.tickets.get(id) || null;
        const prints = prev ? Number(prev.prints || 1) + 1 : 1;

        const tickets = Array.from({ length: count }, (_, idx) => {
          const d = details[idx] || {};
          const title = d.Title || 'Mr';
          const first = d.Firstname || `Passenger${idx + 1}`;
          const sur = d.Surname || 'Test';
          const tel = d.Telephone || '';
          const seat = d.Seat || String(idx + 1);
          const ticketNum = `T${id.replace(/\W/g, '').slice(-8)}${pad2(idx + 1)}`;
          return {
            Prints: prints,
            Title: title,
            Firstname: first,
            Surname: sur,
            Telephone: tel,
            SeatNo: seat,
            TicketNumber: ticketNum,
            RouteName: `${depStop.city} -> ${destStop.city}`,
            Operator: 'Eagleliner Coaches',
            DepartureStopName: depStop.name || depStop.city,
            DestinationStopName: destStop.name || destStop.city,
            DepartureDateTime: depDt,
            DestinationArrivalTime: arrDt,
            Amount: null,
            Type: 'Adult',
          };
        });

        mockState.tickets.set(id, { tickets, prints });

        return {
          Success: true,
          ReservationID: id,
          Tickets: tickets,
          Message: 'Tickets printed (mock)',
        };
      }

      return { Success: false, Error: `Unhandled mock endpoint ${m} ${p}` };
    }

    return { request };
  }

  const baseUrl = process.env.EAGLE_BASE_URL || 'https://enable.eaglezim.co.za';
  const timeoutMs = Number(process.env.EAGLE_TIMEOUT_MS) || 30000;

  const http = axios.create({
    baseURL: baseUrl,
    timeout: timeoutMs,
    validateStatus: () => true,
  });

  async function request({ method, path, username, password, data }) {
    const payload = data
      ? { ...buildCredentials({ username, password }), ...data }
      : buildCredentials({ username, password });

    const res = await http.request({
      method,
      url: path,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: payload,
    });

    if (res.status >= 400) {
      const err = new Error(`Eagleliner upstream error ${res.status}`);
      err.statusCode = 502;
      err.details = res.data;
      throw err;
    }

    return res.data;
  }

  return { request };
}
