export interface SearchQuery {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  tripType: 'one-way' | 'round-trip';
  passengers: { adults: number; children: number; seniors?: number; students?: number; childrenAges?: number[] };
  filters?: { maxPrice?: number; departureTime?: string; operators?: string[]; amenities?: string[] };
  provider?: 'busbud' | 'eagleliner' | string;
  selectedTrip?: BusRoute;
  tripSelectionResponse?: { trip: BusRoute; [key: string]: any };
  searchId?: string;
  timestamp?: number;
}

export interface BusRoute {
  id: string;
  tripId: string;
  journey_id?: string;
  provider?: string;
  busCompany: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  price: number;
  amenities: string[];
  operator?: string;
  className?: string;
  currency?: string;
  deeplink?: string;
  segments?: any[];
  prices?: any[];
  availableSeats?: number;
  reservedSeats?: number;
  occupiedSeats?: number;
  cancellationPolicy?: {
    refundable: boolean;
    deadline?: string;
    fee?: number;
  };
  // Additional properties used by the API layer
  search_id?: string;
  leg_hashes?: string[];
  route_ids?: string[];
  version?: number;
  // Properties used for segment extraction
  segment_id?: string;
  legs?: any[];
}

export interface Ticket {
  type: string;
  price: number;
  currency: string;
  // Add other ticket-related fields as needed
}

export interface Segment {
  id: string;
  ticketType: string;
  // Add other segment-related fields as needed
}

export interface BookingPassenger {
  firstName: string;
  lastName: string;
  type: 'adult' | 'child' | 'senior' | 'student';
  seatNumber?: string;
  idNumber?: string;
  idType?: string;
  nationality?: string;
  dateOfBirth?: string;
  gender?: string;
}

export interface TripSegment {
  id: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  operator: string;
  vehicle: {
    type: string;
    amenities: string[];
  };
  price: {
    amount: number;
    currency: string;
  };
  availableSeats: number;
}

export interface LoadingStep {
  title: string;
  status: 'pending' | 'active' | 'complete';
}

export interface Passenger {
  firstName: string;
  lastName: string;
  type: 'adult' | 'child';
  dob: string;
  gender: string;
  idType: string;
  idNumber: string;
  nationality: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  questionAnswers?: Record<string, string>;
  ticketType?: string;
  ticket?: Ticket;
  segments?: Segment[];
  // Add other passenger-related fields as needed
}

export interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  optInMarketing: boolean;
}

export interface TripSelectionResponse {
  success: boolean;
  cartId?: string;
  tripId?: string;
  segmentInfo?: Array<{id: string, isLegacy: boolean}>;
  isRoundTrip?: boolean;
  tripCount?: number;
  trip?: { tripType: 'roundtrip' | 'oneway' | string; trips: Array<{ id: string; type: 'outbound' | 'return' | string }> };
  message?: string;
}

export interface BookingDetails {
  contactInfo: ContactInfo;
  passengers: Passenger[];
  paymentMethod: string;
  tripId: string;
  searchQuery?: any; // You might want to create a more specific type for this
  // Add other booking-related fields as needed
}
