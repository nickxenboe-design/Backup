export type TripErrorContext =
  | 'search'
  | 'trip-selection'
  | 'booking'
  | 'purchase'
  | 'ticket'
  | 'generic';

export interface MapTripErrorOptions {
  context: TripErrorContext;
  error?: unknown;
  message?: string;
  fallbackTitle?: string;
  fallbackMessage?: string;
}

export interface MappedTripError {
  title: string;
  message: string;
  details?: string;
}

const DEFAULT_TITLES: Record<TripErrorContext, string> = {
  'search': 'Unable to load trips',
  'trip-selection': 'Unable to reserve trip',
  'booking': 'Booking not submitted',
  'purchase': 'Purchase not completed',
  'ticket': 'Unable to load ticket',
  'generic': 'Something went wrong',
};

const DEFAULT_MESSAGES: Record<TripErrorContext, string> = {
  'search': 'We ran into a problem while searching for trips. Please try again.',
  'trip-selection': 'We could not reserve this trip. Please pick another option and try again.',
  'booking': 'We could not submit your booking. Please try again.',
  'purchase': 'We could not complete your purchase. Please try again.',
  'ticket': 'We could not load your ticket details. Please try again.',
  'generic': 'We ran into a problem. Please try again.',
};

function getRawMessage(opts: MapTripErrorOptions): string | undefined {
  if (typeof opts.message === 'string' && opts.message.trim().length > 0) {
    return opts.message.trim();
  }

  if (opts.error instanceof Error && typeof opts.error.message === 'string') {
    const msg = opts.error.message.trim();
    if (msg.length > 0) return msg;
  }

  if (opts.error && typeof opts.error === 'object') {
    const anyErr = opts.error as any;
    const possible = anyErr?.message || anyErr?.error || anyErr?.reason;
    if (typeof possible === 'string' && possible.trim().length > 0) {
      return possible.trim();
    }
  }

  return undefined;
}

export function mapTripErrorToUserMessage(options: MapTripErrorOptions): MappedTripError {
  const ctx: TripErrorContext = options.context || 'generic';
  const raw = getRawMessage(options);
  const rawLower = (raw || '').toLowerCase();

  const baseTitle = options.fallbackTitle || DEFAULT_TITLES[ctx] || DEFAULT_TITLES.generic;
  const baseMessage = options.fallbackMessage || DEFAULT_MESSAGES[ctx] || DEFAULT_MESSAGES.generic;

  // No raw details: fall back entirely to defaults
  if (!raw) {
    return {
      title: baseTitle,
      message: baseMessage,
      details: undefined,
    };
  }

  // Network / connectivity
  if (rawLower.includes('network error') || rawLower.includes('failed to fetch')) {
    const title = 'Connection issue';
    let message: string;

    if (ctx === 'search') {
      message = 'We could not reach our trip search service. Please check your connection and try again.';
    } else if (ctx === 'purchase' || ctx === 'booking') {
      message = 'We could not reach our booking service. Please try again in a few minutes.';
    } else if (ctx === 'ticket') {
      message = 'We could not reach our ticket service. Please try again in a few minutes.';
    } else {
      message = 'We could not connect. Please check your connection and try again.';
    }

    return { title, message, details: raw };
  }

  // Polling timeout for trips
  if (rawLower.includes('timeout') && rawLower.includes('trips not ready')) {
    return {
      title: 'Search is taking too long',
      message:
        'Your trip results are taking longer than expected to load. Please try again, or adjust your dates and search again.',
      details: raw,
    };
  }

  // Invalid API / search context errors
  if (rawLower.includes('invalid api response') || rawLower.includes('missing search context')) {
    return {
      title: 'Trip results unavailable',
      message:
        'We could not load trips from our partners right now. Please try again in a few minutes.',
      details: raw,
    };
  }

  // Cart / booking reference issues
  if (
    rawLower.includes('cart data missing') ||
    rawLower.includes('no cart data found') ||
    rawLower.includes('missing busbudcartid') ||
    rawLower.includes('missing busbudcartid or tripid') ||
    rawLower.includes('no booking reference found')
  ) {
    let message: string;

    if (ctx === 'booking') {
      message = 'We could not find your selected trip. Please go back to the results and choose a trip again.';
    } else if (ctx === 'purchase') {
      message = 'We could not find your booking reference. Please start a new booking.';
    } else if (ctx === 'trip-selection') {
      message = 'We could not reserve this trip. Please choose another option and try again.';
    } else {
      message = baseMessage;
    }

    return {
      title: baseTitle,
      message,
      details: raw,
    };
  }

  // Invalid trip data / segment info
  if (rawLower.includes('invalid trip data')) {
    let message: string;

    if (ctx === 'trip-selection') {
      message = 'We could not process this trip option. Please pick a different trip and try again.';
    } else if (ctx === 'booking') {
      message = 'We could not process this trip for booking. Please pick a different trip and try again.';
    } else {
      message = baseMessage;
    }

    return {
      title: baseTitle,
      message,
      details: raw,
    };
  }

  // Validation for child passenger age
  if (rawLower.includes('age is required for child passenger')) {
    return {
      title: 'Missing child passenger details',
      message:
        'Age is required for all child passengers. Please add a valid date of birth for each child and try again.',
      details: raw,
    };
  }

  // HTTP / server errors
  if (rawLower.includes('server error:') || rawLower.includes('http error')) {
    // Try to extract status code if present
    const statusMatch = raw.match(/(\d{3})/);
    const statusText = statusMatch ? statusMatch[1] : undefined;

    let message: string;

    if (ctx === 'search') {
      message = 'Our trip search service is temporarily unavailable. Please try again in a few minutes.';
    } else if (ctx === 'trip-selection') {
      message = 'We could not reserve this trip due to a server issue. Please choose another trip or try again later.';
    } else if (ctx === 'booking') {
      message = 'We could not submit your booking due to a server issue. Please try again later.';
    } else if (ctx === 'purchase') {
      message = 'We could not complete your purchase due to a server issue. Please try again later.';
    } else if (ctx === 'ticket') {
      message = 'We could not load your ticket due to a server issue. Please try again later.';
    } else {
      message = baseMessage;
    }

    if (statusText) {
      message += ` (Error ${statusText})`;
    }

    return {
      title: baseTitle,
      message,
      details: raw,
    };
  }

  // JSON / response parse issues
  if (rawLower.includes('invalid json response') || rawLower.includes('response parsing failed')) {
    return {
      title: baseTitle,
      message:
        ctx === 'purchase'
          ? 'We could not confirm your purchase due to an unexpected response. Please try again.'
          : baseMessage,
      details: raw,
    };
  }

  // Fallback: use provided fallback text, otherwise a generic friendly message.
  return {
    title: baseTitle,
    message: baseMessage,
    details: raw,
  };
}
