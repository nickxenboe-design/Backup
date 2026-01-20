import React, { useState, useCallback, useEffect } from 'react';

import BusSearchBar from './src/components/BusSearchBar';
import Results from './src/components/Results';
import PassengerInfo from './src/components/PassengerInfo';
import { BookingDetails, LoadingStep } from './src/types';
import FloatingSearchBar from './src/components/FloatingSearchBar';
import { MenuIcon, XIcon, ArrowRightIcon, MinusIcon, PlusIcon, PriceTagIcon } from './src/components/icons';
import BookingConfirmation from './src/components/BookingConfirmation';
import DarkModeToggle from './src/components/DarkModeToggle';
import ConfirmationModal from './src/components/ConfirmationModal';
import TicketDisplay from './src/components/TicketDisplay';
import PaymentConfirmationModal from './src/components/PaymentConfirmationModal';
import LoadingModal from './src/components/LoadingModal';
import ErrorModal, { ErrorModalType } from './src/components/ErrorModal';
import Toast from './src/components/Toast';
import { searchTrips, SearchQuery, BusRoute, selectTrip, submitBooking, getCartData, saveCartData, checkApiHealth, confirmPurchase, clearPurchaseData, getPurchaseData, getPurchaseStatus, sendEmailNotification, addBookingToHistory } from './src/utils/api';
import { setAgentHeaders, setAgentModeActive, isAgentModeActive, getAgentHeaders, hasAgentSessionStarted } from './src/utils/agentHeaders';

import { mapTripErrorToUserMessage } from './src/utils/errorMessages';
import { useAuth } from './src/contexts/AuthContext';
import SignInModal from './src/components/SignInModal';
import SignUpModal from './src/components/SignUpModal';
import AdminDashboard from './src/components/AdminDashboard';
import UserDashboard from './src/components/UserDashboard';
import AgentDashboard from './src/components/AgentDashboard';
import AgentLoginPage from './src/components/AgentLoginPage';
import AgentRegistrationPage from './src/components/AgentRegistrationPage';
import ViewTicketsPage from './src/components/ViewTicketsPage';

type View = 'home' | 'results' | 'passenger-info' | 'confirmation' | 'ticket' | 'dashboard';
type Theme = 'light' | 'dark';

interface CurrentBooking {
  outbound: BusRoute | null;
  inbound: BusRoute | null;
}

const navLinks = [
  { name: 'Flights', href: '#', active: false },
  { name: 'Buses', href: '#', active: true },
  { name: 'Events', href: '#', active: false },
];

function App() {
  const { user, loading: authLoading, signOut, refreshUser } = useAuth();
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentQuery, setCurrentQuery] = useState<SearchQuery | null>(null);
  const [currentBooking, setCurrentBooking] = useState<CurrentBooking>({ outbound: null, inbound: null });
  const [bookingDetails, setBookingDetails] = useState<BookingDetails | null>(null);
  const [pendingBookingDetails, setPendingBookingDetails] = useState<BookingDetails | null>(null);
  const [pnr, setPnr] = useState<string | undefined>(undefined);
  const [view, setView] = useState<View>('home');
  const [isSearchEditorOpen, setIsSearchEditorOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [isSignUpOpen, setIsSignUpOpen] = useState(false);
  const [isConfirmationModalOpen, setIsConfirmationModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingSteps, setLoadingSteps] = useState<LoadingStep[]>([]);
  const [loadingTitle, setLoadingTitle] = useState<string | undefined>(undefined);
  const [loadingSubtitle, setLoadingSubtitle] = useState<string | undefined>(undefined);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorModalTitle, setErrorModalTitle] = useState('');
  const [errorModalMessage, setErrorModalMessage] = useState('');
  const [errorModalDetails, setErrorModalDetails] = useState<string | undefined>(undefined);
  const [errorModalVariant, setErrorModalVariant] = useState<'error' | 'info'>('error');
  const [errorModalType, setErrorModalType] = useState<ErrorModalType | undefined>(undefined);
  const [errorModalPrimaryActionLabel, setErrorModalPrimaryActionLabel] = useState<string | undefined>(undefined);
  const [errorModalPrimaryAction, setErrorModalPrimaryAction] = useState<(() => void) | undefined>(undefined);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastTitle, setToastTitle] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState<'info' | 'warning'>('info');

  const [priceUpdateModalOpen, setPriceUpdateModalOpen] = useState(false);
  const [pendingPriceUpdate, setPendingPriceUpdate] = useState<
    | {
        quoted: number;
        finalTotal: number;
        currency: string;
      }
    | null
  >(null);
  const [isEmbedSearch, setIsEmbedSearch] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      const embedParam = params.get('embed');
      let isIframe = false;
      try {
        isIframe = window.self !== window.top;
      } catch (_e) {
        isIframe = true;
      }
      return embedParam === 'search' && isIframe;
    } catch (_e) {
      return false;
    }
  });
  const [hasBootstrappedFromUrl, setHasBootstrappedFromUrl] = useState(false);
  const [agentAuthLoading, setAgentAuthLoading] = useState(false);
  const [agentAuthError, setAgentAuthError] = useState<string | null>(null);
  const [agentAuthChecked, setAgentAuthChecked] = useState(false);

  const userLabel = (user?.email || user?.displayName || 'Account');
  const userInitial = userLabel.charAt(0).toUpperCase();
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const storedTheme = window.localStorage.getItem('theme') as Theme;
      if (storedTheme) {
        return storedTheme;
      }
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'light';
  });

  // Ticket state
  const [currentTicket, setCurrentTicket] = useState<{ cartId: string; ticketId?: string } | null>(null);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!isEmbedSearch) return;
    if (typeof window === 'undefined') return;

    const sendHeight = () => {
      const rootElement = document.getElementById('root');
      if (!rootElement) return;
      const height = rootElement.scrollHeight || rootElement.offsetHeight;
      try {
        window.parent.postMessage({ type: 'nt-embed-resize', height }, '*');
      } catch (e) {}
    };

    sendHeight();

    const ResizeObserverImpl = (window as any).ResizeObserver;
    let observer: any = null;
    const rootElement = document.getElementById('root');

    if (ResizeObserverImpl && rootElement) {
      observer = new ResizeObserverImpl(() => {
        sendHeight();
      });
      observer.observe(rootElement);
    }

    const handleResize = () => {
      sendHeight();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (observer && rootElement) {
        observer.unobserve(rootElement);
        observer.disconnect();
      }
      window.removeEventListener('resize', handleResize);
    };
  }, [isEmbedSearch]);

  // Ensure agent headers are preserved when present, but cleared in obvious non-agent contexts without prior agent mode
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname || '';
    const isAgentContext =
      path.startsWith('/agent-dashboard') ||
      path.startsWith('/agent/login') ||
      path.startsWith('/agent/register');
    if (!isEmbedSearch && !isAgentContext && !hasAgentSessionStarted()) {
      setAgentModeActive(false);
      setAgentHeaders({});
    }
  }, [isEmbedSearch]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.pathname.startsWith('/agent-dashboard')) return;
    if (agentAuthChecked) return;

    const hasAgentHeaders = (() => {
      try {
        const h = getAgentHeaders() || {};
        const email = typeof (h as any)['x-agent-email'] === 'string' ? (h as any)['x-agent-email'] : '';
        const id = typeof (h as any)['x-agent-id'] === 'string' ? (h as any)['x-agent-id'] : '';
        return Boolean(email || id);
      } catch {
        return false;
      }
    })();

    const agentAuthOptional = String((import.meta as any).env?.VITE_AGENT_AUTH_OPTIONAL || 'false')
      .toLowerCase() === 'true';
    // Header-only agent mode (embed/agent redirect): don't require cookie-based agent_jwt.
    if (agentAuthOptional || hasAgentHeaders) {
      setAgentAuthChecked(true);
      return;
    }

    let cancelled = false;
    setAgentAuthLoading(true);
    setAgentAuthError(null);

    // Fail-safe timeout: avoid indefinite spinner if the auth call hangs
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setAgentAuthLoading(false);
      }
    }, 6000);

    (async () => {
      try {
        await refreshUser();
        if (!cancelled && (!user || !(user as any).role)) {
          setAgentAuthError('Agent role missing. Please ensure your account has role "agent" or contact admin.');
        }
      } catch (e: any) {
        if (!cancelled) {
          setAgentAuthError(e?.message || 'Could not verify agent session. Please try signing in again.');
        }
      } finally {
        if (!cancelled) {
          setAgentAuthLoading(false);
          setAgentAuthChecked(true);
        }
        window.clearTimeout(timeoutId);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [refreshUser, agentAuthChecked, user]);

  // Fallback: if auth context finishes loading, make sure agentAuthLoading is cleared
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.pathname.startsWith('/agent-dashboard')) return;
    if (authLoading) return;
    if (agentAuthChecked) return;
    setAgentAuthLoading(false);
    setAgentAuthChecked(true);
  }, [authLoading, agentAuthChecked]);

  // If we already have an agent user in context, stop showing the spinner immediately
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.pathname.startsWith('/agent-dashboard')) return;
    if (agentAuthChecked) return;
    if (user && (user as any).role === 'agent') {
      setAgentAuthLoading(false);
      setAgentAuthError(null);
      setAgentAuthChecked(true);
    }
  }, [user, agentAuthChecked]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  const handleCloseErrorModal = useCallback(() => {
    setErrorModalOpen(false);
    setErrorModalVariant('error');
    setErrorModalType(undefined);
    setErrorModalPrimaryActionLabel(undefined);
    setErrorModalPrimaryAction(undefined);
  }, []);

  const handleErrorModalClose = useCallback(() => {
    const shouldContinue = errorModalVariant === 'info' && typeof errorModalPrimaryAction === 'function';
    const continueAction = shouldContinue ? errorModalPrimaryAction : undefined;
    handleCloseErrorModal();
    if (continueAction) {
      try {
        continueAction();
      } catch {}
    }
  }, [errorModalVariant, errorModalPrimaryAction, handleCloseErrorModal]);

  const inferErrorType = (text: string): ErrorModalType => {
    const raw = String(text || '').toLowerCase();
    if (!raw) return 'unknown';
    if (raw.includes('failed to fetch') || raw.includes('network error') || raw.includes('cors')) return 'connection';
    if (raw.includes('timeout') || raw.includes('taking too long')) return 'timeout';
    if (raw.includes('required') || raw.includes('invalid') || raw.includes('please choose') || raw.includes('check')) return 'validation';
    if (raw.includes('sign in') || raw.includes('login') || raw.includes('unauthorized') || raw.includes('forbidden') || raw.includes('agent access required')) return 'auth';
    if (raw.includes('not found') || raw.includes('404')) return 'not_found';
    if (raw.includes('unavailable')) return 'unavailable';
    if (raw.includes('server')) return 'server';
    return 'unknown';
  };

  const showError = useCallback((title: string, message: string, details?: string, typeOverride?: ErrorModalType) => {
    setErrorModalTitle(title);
    setErrorModalMessage(message);
    setErrorModalDetails(details);
    setErrorModalVariant('error');
    setErrorModalType(typeOverride || inferErrorType([title, message, details].filter(Boolean).join('\n')));
    setErrorModalPrimaryActionLabel(undefined);
    setErrorModalPrimaryAction(undefined);
    setErrorModalOpen(true);
  }, []);

  const showToast = useCallback((opts: { title: string; message: string; variant?: 'info' | 'warning' }) => {
    setToastTitle(opts.title);
    setToastMessage(opts.message);
    setToastVariant(opts.variant || 'info');
    setToastOpen(true);
  }, []);

  const handleAcknowledgePriceUpdate = useCallback(() => {
    if (!pendingPriceUpdate) return;

    const { quoted, finalTotal, currency } = pendingPriceUpdate;

    setCurrentBooking((prev) => {
      if (!prev.outbound) return prev;

      const legs = (prev.outbound as any)?.legs;
      const isAggregatedRoundTrip = !prev.inbound && Array.isArray(legs) && legs.length >= 2;

      if (prev.inbound) {
        const oldOutbound = typeof prev.outbound.price === 'number' ? prev.outbound.price : 0;
        const oldInbound = typeof prev.inbound.price === 'number' ? prev.inbound.price : 0;
        const oldTotal = oldOutbound + oldInbound;
        if (oldTotal > 0) {
          const ratio = finalTotal / oldTotal;
          return {
            ...prev,
            outbound: { ...prev.outbound, price: oldOutbound * ratio, currency },
            inbound: { ...prev.inbound, price: oldInbound * ratio, currency },
          };
        }
      }

      const outboundPrice = finalTotal;
      const nextOutbound = (() => {
        if (!isAggregatedRoundTrip) {
          return { ...prev.outbound, price: outboundPrice, currency };
        }

        const leg0Price = Number(legs?.[0]?.price || 0);
        const leg1Price = Number(legs?.[1]?.price || 0);
        const legsTotal = (Number.isFinite(leg0Price) ? leg0Price : 0) + (Number.isFinite(leg1Price) ? leg1Price : 0);

        if (legsTotal > 0 && Number.isFinite(outboundPrice) && outboundPrice > 0) {
          const ratio = outboundPrice / legsTotal;
          const scaledLegs = legs.map((l: any, idx: number) => {
            const base = idx === 0 ? leg0Price : (idx === 1 ? leg1Price : Number(l?.price || 0));
            const v = Number.isFinite(base) ? base : 0;
            const scaled = Math.round((v * ratio) * 100) / 100;
            return { ...l, price: scaled, currency };
          });
          return { ...prev.outbound, price: outboundPrice, currency, legs: scaledLegs };
        }

        return { ...prev.outbound, price: outboundPrice, currency };
      })();

      return {
        ...prev,
        outbound: nextOutbound,
      };
    });

    try {
      saveCartData({ quotedTotal: finalTotal, quotedCurrency: currency });
    } catch {}

    console.log(' user acknowledged price update', { quoted, finalTotal, currency });

    setPendingPriceUpdate(null);
    setPriceUpdateModalOpen(false);
    setIsPaymentModalOpen(true);
  }, [pendingPriceUpdate]);

  const showInfo = useCallback((opts: { title: string; message: string; details?: string; primaryActionLabel?: string; onPrimaryAction?: () => void }) => {
    setErrorModalTitle(opts.title);
    setErrorModalMessage(opts.message);
    setErrorModalDetails(opts.details);
    setErrorModalVariant('info');
    setErrorModalType(undefined);
    setErrorModalPrimaryActionLabel(opts.primaryActionLabel);
    setErrorModalPrimaryAction(() => {
      handleCloseErrorModal();
      try {
        opts.onPrimaryAction?.();
      } catch {}
    });
    setErrorModalOpen(true);
  }, [handleCloseErrorModal]);

  const handleTripSelectionError = useCallback((error: unknown) => {
    const mapped = mapTripErrorToUserMessage({
      context: 'trip-selection',
      error,
    });
    showError(mapped.title, mapped.message, mapped.details);
  }, [showError]);

  const handleSearch = useCallback(async (query: SearchQuery, options?: { isReturnLegSearch?: boolean }) => {
    const isInitialSearch = view !== 'results' || options?.isReturnLegSearch;
    setIsRefetching(!isInitialSearch);
    setLoading(true);
    setError(null);
    if (isInitialSearch) {
      setRoutes([]);
    }

    if (!options?.isReturnLegSearch) {
      setCurrentQuery(query);
      setCurrentBooking({ outbound: null, inbound: null });
    }

    const initialSteps: LoadingStep[] = [
      { title: 'Initializing your search...', status: 'pending' },
      { title: 'Finding available routes...', status: 'pending' },
      { title: 'Checking seat availability...', status: 'pending' },
      { title: 'Finalizing results...', status: 'pending' },
    ];
    setLoadingSteps(initialSteps);
    setLoadingProgress(0);
    setLoadingTitle('Searching for trips...');
    setLoadingSubtitle('Hang tight while we find the best options for you.');
    setShowLoadingModal(true);

    const updateStep = (index: number, status: LoadingStep['status']) => {
      setLoadingSteps(prev => prev.map((step, i) => i === index ? { ...step, status } : step));
    };

    updateStep(0, 'active');
    setLoadingProgress(10);
    await new Promise(res => setTimeout(res, 500));
    updateStep(0, 'complete');
    updateStep(1, 'active');
    setLoadingProgress(30);

    try {
      if (isInitialSearch) {
        setView('results');
      }
      setIsSearchEditorOpen(false);

      const response = await searchTrips(query);
      setLoadingProgress(60);
      await new Promise(res => setTimeout(res, 500));
      updateStep(1, 'complete');
      updateStep(2, 'active');

      if (response && response.length >= 0) {
        setRoutes(response);

        if (response.length > 0 && currentQuery) {
          let searchId = response.find(trip => trip.search_id)?.search_id;

          if (!searchId) {
            const firstTrip = response[0];
            if (firstTrip.id) {
              try {
                const decodedId = JSON.parse(atob(firstTrip.id));
                searchId = decodedId.searchId || decodedId.search_id || decodedId.id;
              } catch {}
            }
          }

          if (searchId) {
            setCurrentQuery(prev => prev ? { ...prev, searchId } : null);
          }
        }
      } else {
        const mapped = mapTripErrorToUserMessage({
          context: 'search',
          message: 'Invalid API response',
        });
        showError(mapped.title, mapped.message, mapped.details);
        setRoutes([]);
      }
    } catch (e) {
      const mapped = mapTripErrorToUserMessage({
        context: 'search',
        error: e,
      });
      showError(mapped.title, mapped.message, mapped.details);
      setRoutes([]);
    } finally {
      setLoadingProgress(100);
      updateStep(3, 'complete');
      await new Promise(res => setTimeout(res, 500));
      setShowLoadingModal(false);
      setLoading(false);
      setIsRefetching(false);
    }
  }, [view, currentQuery, showError]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hasBootstrappedFromUrl) return;
    if (isEmbedSearch) return;

    try {
      const params = new URLSearchParams(window.location.search);
      const origin = params.get('origin');
      const destination = params.get('destination');
      const departureDate = params.get('departureDate');

      if (!origin || !destination || !departureDate) {
        return;
      }

      const tripTypeParam = params.get('tripType');
      const tripType: 'one-way' | 'round-trip' =
        tripTypeParam === 'round-trip' ? 'round-trip' : 'one-way';

      const returnDateParam = params.get('returnDate') || undefined;
      const adultsParam = params.get('adults');
      const childrenParam = params.get('children');

      const adults = Math.max(1, parseInt(adultsParam || '1', 10) || 1);
      const children = Math.max(0, parseInt(childrenParam || '0', 10) || 0);

      const nextQuery: SearchQuery = {
        origin,
        destination,
        departureDate,
        ...(returnDateParam ? { returnDate: returnDateParam } : {}),
        tripType,
        passengers: { adults, children },
      };

      setHasBootstrappedFromUrl(true);
      handleSearch(nextQuery);
    } catch (e) {
      console.error('Failed to bootstrap search from URL params', e);
    }
  }, [handleSearch, hasBootstrappedFromUrl, isEmbedSearch]);

  const handleEmbedSearch = useCallback((query: SearchQuery) => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams();
    params.set('origin', query.origin);
    params.set('destination', query.destination);
    params.set('departureDate', query.departureDate);
    if (query.returnDate) {
      params.set('returnDate', query.returnDate);
    }
    params.set('tripType', query.tripType);
    params.set('adults', String(query.passengers.adults || 0));
    params.set('children', String(query.passengers.children || 0));

    const targetUrl = `${window.location.origin}/?${params.toString()}`;
    if (window.top) {
      window.top.location.href = targetUrl;
    } else {
      window.location.href = targetUrl;
    }
  }, []);

  const handleSelectRoute = async (route: BusRoute) => {
    try {
      console.log(' Handling route selection for route:', route.id);
      console.log(' Route data:', {
        id: route.id,
        tripId: route.tripId,
        origin: route.origin,
        destination: route.destination,
        search_id: route.search_id,
        price: route.price
      });
      console.log(' Current query:', currentQuery);

      // Save the selected trip as the current booking
      if (currentQuery?.tripType === 'one-way') {
        setCurrentBooking({ outbound: route, inbound: null });
      } else if (currentQuery?.tripType === 'round-trip') {
        if (!currentBooking.outbound) {
          // selecting outbound leg
          setCurrentBooking({ outbound: route, inbound: null });
        } else {
          // selecting inbound leg
          setCurrentBooking(prev => ({ ...prev, inbound: route }));
        }
      }

      // Open the review modal instead of navigating to a separate details page
      setIsConfirmationModalOpen(true);
      if (view !== 'results') {
        setView('results');
      }

      // Debug: Check if cart data was saved
      setTimeout(() => {
        const cartAfterSelection = getCartData();
        console.log(' Cart data after trip selection:', cartAfterSelection);
      }, 100);
    } catch (error) {
      console.error(' Error in handleSelectRoute:', error);
      // Fallback to frontend-only selection
      if (currentQuery?.tripType === 'one-way') {
        setCurrentBooking({ outbound: route, inbound: null });
      } else if (currentQuery?.tripType === 'round-trip') {
        if (!currentBooking.outbound) {
          setCurrentBooking({ outbound: route, inbound: null });
          if (currentQuery.returnDate) {
            const returnQuery: SearchQuery = {
              ...currentQuery,
              origin: currentQuery.destination,
              destination: currentQuery.origin,
              departureDate: currentQuery.returnDate,
              returnDate: null,
              tripType: 'one-way'
            };
            handleSearch(returnQuery, { isReturnLegSearch: true });
          }
        } else {
          setCurrentBooking(prev => ({ ...prev, inbound: route }));
        }
      }

      // Still open the review modal so the user can confirm the trip
      setIsConfirmationModalOpen(true);
      if (view !== 'results') {
        setView('results');
      }
    }
  };

  const handleResetOutbound = () => {
    setCurrentBooking({ outbound: null, inbound: null });
    if (currentQuery) {
        handleSearch(currentQuery);
    }
  };

  const handleBackToResults = () => {
     if (currentQuery?.tripType === 'round-trip' && currentBooking.outbound) {
        setCurrentBooking(prev => ({ ...prev, inbound: null }));
    }
    setView('results');
  };
  
  const handleConfirmBooking = () => {
      setIsConfirmationModalOpen(false);
      setView('passenger-info');
  }

  const handleChangeTripDetailsFromConfirm = (section: 'route' | 'date' | 'passengers') => {
    setIsConfirmationModalOpen(false);
    setView('results');
    setIsSearchEditorOpen(true);
  };
  
  const handleReviewBooking = async (details: BookingDetails) => {
    if (currentBooking.outbound && currentQuery) {
      try {
        // Show loading modal for booking submission (user-friendly copy)
        setLoadingTitle('Preparing your booking...');
        setLoadingSubtitle("We're securing your seats and creating your order.");
        setShowLoadingModal(true);
        setLoadingProgress(0);
        setLoadingSteps([
          { title: 'confirming details', status: 'active' },
          { title: 'submitting details', status: 'pending' },
          { title: 'Details submitted', status: 'pending' }
        ]);

        console.log(' Starting simplified booking submission process...');
        console.log(' Details:', details);

        // Call the booking submission API
        const bookingResult = await submitBooking({
          contactInfo: details.contactInfo,
          passengers: details.passengers,
          paymentMethod: details.paymentMethod,
          tripId: currentBooking.outbound.id,
          searchQuery: currentQuery
        });

        console.log(' Booking result:', bookingResult);

        setLoadingProgress(50);

        if (bookingResult.success) {
          console.log(' Successfully submitted booking:', bookingResult);
          setLoadingSteps(prev => prev.map((step, i) =>
            i === 0 ? { ...step, status: 'complete' } :
            i === 1 ? { ...step, status: 'complete' } :
            i === 2 ? { ...step, status: 'active' } : step
          ));
          setLoadingProgress(100);

          // Store booking details for payment confirmation
          setPendingBookingDetails(details);
          // Capture PNR from response or session storage
          try {
            const sessionPnr = getPurchaseData()?.pnr;
            setPnr(bookingResult.pnr || sessionPnr);
          } catch {}

          try {
            const cartData = getCartData();
            const quotedFromCart = typeof cartData?.quotedTotal === 'number' ? cartData.quotedTotal : null;
            const finalTotal = typeof (bookingResult as any)?.finalTotal === 'number' ? (bookingResult as any).finalTotal : null;

            const fallbackQuoted = (() => {
              try {
                if (!currentBooking?.outbound) return null;
                const legs = (currentBooking.outbound as any)?.legs;
                const isAggregatedRoundTrip = !currentBooking.inbound && Array.isArray(legs) && legs.length >= 2;
                const outbound = typeof currentBooking.outbound.price === 'number' ? currentBooking.outbound.price : 0;
                const inbound = currentBooking.inbound && typeof currentBooking.inbound.price === 'number' ? currentBooking.inbound.price : 0;
                if (currentBooking.inbound) return outbound + inbound;
                if (isAggregatedRoundTrip) {
                  const leg0 = Number(legs?.[0]?.price || 0);
                  const leg1 = Number(legs?.[1]?.price || 0);
                  const legsTotal = (Number.isFinite(leg0) ? leg0 : 0) + (Number.isFinite(leg1) ? leg1 : 0);
                  return legsTotal > 0 ? legsTotal : outbound;
                }
                return outbound;
              } catch {
                return null;
              }
            })();

            const quoted = quotedFromCart ?? fallbackQuoted;

            console.log(' quoted vs final', {
              quotedFromCart,
              fallbackQuoted,
              quotedUsed: quoted,
              finalTotal,
              cartPricing: cartData ? { quotedTotal: cartData.quotedTotal, quotedCurrency: cartData.quotedCurrency } : null,
              bookingPricing: { finalTotal: (bookingResult as any)?.finalTotal, currency: (bookingResult as any)?.currency },
            });

            if (
              quoted != null &&
              finalTotal != null &&
              Number.isFinite(quoted) &&
              Number.isFinite(finalTotal) &&
              Math.abs(finalTotal - quoted) >= 0.01
            ) {
              const currency =
                (bookingResult as any)?.currency ||
                cartData?.quotedCurrency ||
                currentBooking.outbound?.currency ||
                'USD';
              const prefix = currency === 'USD' ? '$' : `${currency} `;
              const delta = finalTotal - quoted;
              const absDelta = Math.abs(delta);
              const deltaText = absDelta >= 0.01 ? `${prefix}${absDelta.toFixed(2)}` : '';

              console.log(' price changed; awaiting user acknowledgement', {
                quoted,
                finalTotal,
                currency,
                delta,
                deltaText,
              });

              setPendingPriceUpdate({ quoted, finalTotal, currency });
              setShowLoadingModal(false);
              setPriceUpdateModalOpen(true);
              return;
            }

            if (quoted == null || finalTotal == null) {
              console.log(' skipped: missing quoted or final', { quoted, finalTotal });
            } else {
              console.log(' no change (or below threshold)', { quoted, finalTotal, diff: finalTotal - quoted });
            }
          } catch {}

          // Close loading modal and open payment modal
          setShowLoadingModal(false);
          setIsPaymentModalOpen(true);
        } else {
          console.error(' Booking submission failed:', bookingResult.message);
          const healthCheck = await checkApiHealth();
          console.log(' Middleware health check:', healthCheck);

          const mapped = mapTripErrorToUserMessage({
            context: 'booking',
            message: bookingResult.message,
            fallbackTitle: 'Booking not submitted',
            fallbackMessage: 'We could not submit your booking. Please try again.',
          });

          const detailsParts = [mapped.details, `Middleware status: ${healthCheck.available ? 'Available' : 'Not accessible'}${healthCheck.message ? ` (${healthCheck.message})` : ''}`]
            .filter(Boolean)
            .join('\n');

          showError(mapped.title, mapped.message, detailsParts || undefined);
        }
      } catch (error) {
        console.error(' Error during booking submission:', error);

        const healthCheck = await checkApiHealth();
        console.log(' Middleware health check (catch):', healthCheck);

        const mapped = mapTripErrorToUserMessage({
          context: 'booking',
          error,
          fallbackTitle: 'Booking not submitted',
          fallbackMessage: healthCheck.available
            ? 'An error occurred while submitting your booking. Please try again.'
            : 'We could not reach our booking service. Please try again in a few minutes.',
        });

        const detailsParts = [mapped.details, healthCheck.message ? `Middleware: ${healthCheck.message}` : undefined]
          .filter(Boolean)
          .join('\n');

        showError(mapped.title, mapped.message, detailsParts || undefined);
      } finally {
        setShowLoadingModal(false);
      }
    }
  }

  const handleFinalizeBooking = async () => {
    if (pendingBookingDetails && currentBooking.outbound && currentQuery) {
      try {
        // If In-Store payment, skip purchase confirmation and go straight to summary
        if (pendingBookingDetails.paymentMethod && pendingBookingDetails.paymentMethod.toLowerCase() === 'in-store') {
          setBookingDetails(pendingBookingDetails);
          setView('confirmation');
          setPendingBookingDetails(null);
          setIsPaymentModalOpen(false);

          // Record booking in local history
          try {
            const cartData = getCartData();
            if (cartData?.cartId) {
              addBookingToHistory({
                cartId: cartData.cartId,
                pnr,
                status: 'booked',
                origin: currentQuery.origin,
                destination: currentQuery.destination,
                departAt: currentBooking.outbound.departureTime || currentQuery.departureDate,
                createdAt: Date.now()
              });
            }
          } catch {}

          // Send email notification after booking completion
          if (pnr) {
            console.log(' Sending email notification for In-Store payment');
            try {
              // Fire-and-forget to avoid blocking navigation to success page
              sendEmailNotification(pnr)
                .then((emailResult) => {
                  if (emailResult.success) {
                    console.log(' Email notification sent successfully');
                  } else {
                    console.warn(' Email notification failed:', emailResult.message);
                  }
                })
                .catch((emailError) => {
                  console.error(' Error sending email notification:', emailError);
                });
            } catch (emailError) {
              console.error(' Error scheduling email notification:', emailError);
            }
          }

          return;
        }

        // Show loading modal for purchase confirmation
        setLoadingTitle('Completing your purchase...');
        setLoadingSubtitle('Confirming payment and retrieving your tickets.');
        setShowLoadingModal(true);
        setLoadingProgress(0);
        setLoadingSteps([
          { title: 'Confirming purchase...', status: 'active' },
          { title: 'Processing payment...', status: 'pending' },
          { title: 'Retrieving tickets...', status: 'pending' }
        ]);

        console.log(' Starting purchase confirmation process...');
        console.log(' Details:', pendingBookingDetails);

        // Get cart data for booking reference
        const cartData = getCartData();

        // Call the purchase confirmation API
        const purchaseResult = await confirmPurchase();

        console.log(' Purchase result:', purchaseResult);

        setLoadingProgress(33);

        if (purchaseResult.success) {
          console.log(' Successfully confirmed purchase:', purchaseResult);
          setLoadingSteps(prev => prev.map((step, i) =>
            i === 0 ? { ...step, status: 'complete' } :
            i === 1 ? { ...step, status: 'complete' } :
            i === 2 ? { ...step, status: 'active' } : step
          ));
          setLoadingProgress(100);

          // Record booking in local history
          try {
            if (cartData?.cartId) {
              addBookingToHistory({
                cartId: cartData.cartId,
                pnr,
                status: 'completed',
                origin: currentQuery.origin,
                destination: currentQuery.destination,
                departAt: currentBooking.outbound.departureTime || currentQuery.departureDate,
                createdAt: Date.now()
              });
            }
          } catch {}

          // Purchase successful - show confirmation
          setBookingDetails(pendingBookingDetails);
          setView('confirmation');
          setPendingBookingDetails(null);
        } else {
          console.error(' Purchase confirmation failed:', purchaseResult.message);

          if (purchaseResult.statusCode === 409) {
            const cartData = getCartData();
            const quoted = typeof cartData?.quotedTotal === 'number' ? cartData.quotedTotal : null;

            const purchaseData = getPurchaseData();
            const statusResult = purchaseData?.purchaseId
              ? await getPurchaseStatus(purchaseData.purchaseId, purchaseData.purchaseUuid)
              : null;

            const updatedTotal = typeof statusResult?.total === 'number' ? statusResult.total : null;
            const currency =
              statusResult?.currency ||
              cartData?.quotedCurrency ||
              currentBooking.outbound?.currency ||
              'USD';
            const prefix = currency === 'USD' ? '$' : `${currency} `;

            const message =
              quoted != null && updatedTotal != null && Number.isFinite(quoted) && Number.isFinite(updatedTotal)
                ? (() => {
                    const delta = updatedTotal - quoted;
                    const absDelta = Math.abs(delta);
                    const deltaText = absDelta >= 0.01 ? `${prefix}${absDelta.toFixed(2)}` : '';
                    return delta < 0
                      ? `Good news — the fare dropped. Your new total is ${prefix}${updatedTotal.toFixed(2)} (previously ${prefix}${quoted.toFixed(2)}).`
                      : `Quick update — the operator updated the fare${deltaText ? ` (+${deltaText})` : ''}. Your new total is ${prefix}${updatedTotal.toFixed(2)} (previously ${prefix}${quoted.toFixed(2)}).`;
                  })()
                : 'The fare changed while we were confirming your purchase. To protect you from paying an unexpected amount, please restart the booking so we can show you the latest total before you pay.';

            setShowLoadingModal(false);
            setIsPaymentModalOpen(false);

            showInfo({
              title: 'Price updated',
              message,
              primaryActionLabel: 'Restart booking',
              onPrimaryAction: () => {
                handleCloseErrorModal();
                try {
                  clearPurchaseData();
                } catch {}
                try {
                  saveCartData({});
                } catch {}
                setPnr(undefined);
                setPendingBookingDetails(null);
                setBookingDetails(null);
                setCurrentBooking({ outbound: null, inbound: null });
                setRoutes([]);
                setView('home');
              },
            });
            return;
          }

          const healthCheck = await checkApiHealth();
          console.log(' Middleware health check:', healthCheck);

          const mapped = mapTripErrorToUserMessage({
            context: 'purchase',
            message: purchaseResult.message,
            fallbackTitle: 'Purchase not completed',
            fallbackMessage: 'We could not complete your purchase. Please try again.',
          });

          const detailsParts = [mapped.details, `Middleware status: ${healthCheck.available ? 'Available' : 'Not accessible'}${healthCheck.message ? ` (${healthCheck.message})` : ''}`]
            .filter(Boolean)
            .join('\n');

          showError(mapped.title, mapped.message, detailsParts || undefined);
        }
      } catch (error) {
        console.error(' Error during purchase confirmation:', error);

        const healthCheck = await checkApiHealth();
        console.log(' Middleware health check (catch):', healthCheck);

        const mapped = mapTripErrorToUserMessage({
          context: 'purchase',
          error,
          fallbackTitle: 'Purchase not completed',
          fallbackMessage: healthCheck.available
            ? 'An error occurred while completing your purchase. Please try again.'
            : 'We could not reach our payment service. Please try again in a few minutes.',
        });

        const detailsParts = [mapped.details, healthCheck.message ? `Middleware: ${healthCheck.message}` : undefined]
          .filter(Boolean)
          .join('\n');

        showError(mapped.title, mapped.message, detailsParts || undefined);
      } finally {
        setShowLoadingModal(false);
        setIsPaymentModalOpen(false);
      }
    }
  }
  
  const handleCancelReview = () => {
    setIsPaymentModalOpen(false);
    setPendingBookingDetails(null);
    clearPurchaseData();
    setPnr(undefined);
  }

  const handleStartNewBooking = () => {
      setView('home');
      setCurrentBooking({ outbound: null, inbound: null });
      setRoutes([]);
      setCurrentQuery(null);
      setBookingDetails(null);
      setPendingBookingDetails(null);
      clearPurchaseData();
  }

  const handleViewTickets = (cartId: string, ticketId?: string) => {
      setCurrentTicket({ cartId, ticketId });
      setView('ticket');
  }

  const renderContent = () => {
    if (view === 'dashboard') {
      return (
        <div className="container mx-auto p-4 md:p-6 flex-grow">
          <UserDashboard
            user={user}
            onViewTickets={handleViewTickets}
            onStartNewBooking={handleStartNewBooking}
          />
        </div>
      );
    }

    if (view === 'confirmation' && currentBooking.outbound && currentQuery && bookingDetails) {
      const cartData = getCartData();
      return (
        <div className="container mx-auto p-4 md:p-6 flex-grow">
          <BookingConfirmation
            booking={currentBooking as { outbound: BusRoute; inbound: BusRoute | null }}
            query={currentQuery}
            details={bookingDetails}
            onNewBooking={handleStartNewBooking}
            onViewTickets={
              cartData?.cartId
                ? () => {
                  const lookup = pnr || cartData.cartId;
                  window.location.href = `/tickets/${encodeURIComponent(String(lookup))}`;
                }
                : undefined
            }
            pnr={pnr}
          />
        </div>
      );
    }

    if (view === 'passenger-info' && currentBooking.outbound && currentQuery) {
      return (
        <div className="container mx-auto p-4 md:p-6 flex-grow">
          <PassengerInfo
            booking={currentBooking as { outbound: BusRoute; inbound: BusRoute | null }}
            query={currentQuery}
            onBack={handleBackToResults}
            onReview={handleReviewBooking}
          />
        </div>
      );
    }

    if (view === 'results') {
      return (
        <div className="container mx-auto p-4 md:p-6 flex-grow">
          <Results
            routes={routes}
            loading={loading}
            isRefetching={isRefetching}
            error={error}
            query={currentQuery}
            booking={currentBooking}
            onSelectRoute={handleSelectRoute}
            onSearch={handleSearch}
            onEditSearch={() => setIsSearchEditorOpen(true)}
            onResetOutbound={handleResetOutbound}
            onTripError={handleTripSelectionError}
          />
        </div>
      );
    }

    if (view === 'ticket' && currentTicket) {
      return (
        <div className="container mx-auto p-4 md:p-6 flex-grow">
          <TicketDisplay
            cartId={currentTicket.cartId}
            ticketId={currentTicket.ticketId}
            onBack={() => setView('confirmation')}
          />
        </div>
      );
    }

    // Default to 'home' view
    return (
      <div
        className="relative flex-grow flex flex-col items-center justify-center text-center px-4 py-12 md:py-20"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1570125909232-eb263c186922?q=80&w=2070&auto=format&fit=crop')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/85 via-white/70 to-white/85 backdrop-blur-sm dark:from-gray-950/90 dark:via-gray-950/85 dark:to-gray-900/85"></div>
        <div className="relative container mx-auto px-4 md:px-6 z-10">
          <div className="max-w-3xl mx-auto animate-fade-in">
            <h1 className="text-2xl md:text-4xl font-extrabold text-[#652D8E] dark:text-purple-300 tracking-tight">
              Zimbabwe's Biggets Ticketing Company
            </h1>
            <p className="mt-3 md:mt-4 text-sm md:text-base max-w-2xl mx-auto text-gray-700 dark:text-gray-200">
              Search, compare and book cross-border and domestic buses in minutes. We prioritise routes and cities most
              popular with Zimbabwean and South African travellers.
            </p>
          </div>
          <div className="mt-8 md:mt-10 max-w-4xl mx-auto">
            <BusSearchBar onSearch={handleSearch} loading={loading} />
          </div>
        </div>
      </div>
    );
  };

  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin-dashboard')) {
    return <AdminDashboard />;
  }

  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/agent/login')) {
    return <AgentLoginPage />;
  }

  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/agent/register')) {
    return <AgentRegistrationPage />;
  }

  if (typeof window !== 'undefined' && (window.location.pathname === '/tickets' || window.location.pathname.startsWith('/tickets/'))) {
    return <ViewTicketsPage />;
  }

  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/agent-dashboard')) {
    const agentAuthOptional = String((import.meta as any).env?.VITE_AGENT_AUTH_OPTIONAL || 'false')
      .toLowerCase() === 'true';

    const hasAgentHeaders = (() => {
      try {
        const h = getAgentHeaders() || {};
        const email = typeof (h as any)['x-agent-email'] === 'string' ? (h as any)['x-agent-email'] : '';
        const id = typeof (h as any)['x-agent-id'] === 'string' ? (h as any)['x-agent-id'] : '';
        return Boolean(email || id);
      } catch {
        return false;
      }
    })();

    if (!agentAuthOptional) {
      if (agentAuthLoading) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-sm text-gray-600 dark:text-gray-300">Checking agent session...</div>
            <ErrorModal
              isOpen={Boolean(agentAuthError)}
              onClose={() => {
                try {
                  window.location.assign('/agent/login');
                } catch {
                  window.location.href = '/agent/login';
                }
              }}
              title="Agent session required"
              message="We couldn’t verify your agent session. Please sign in again to continue."
              details={agentAuthError || undefined}
              errorType="auth"
              showTechnicalDetailsToggle={false}
              primaryActionLabel="Go to Agent Login"
              onPrimaryAction={() => {
                try {
                  window.location.assign('/agent/login');
                } catch {
                  window.location.href = '/agent/login';
                }
              }}
              hideCloseButton
              hideCloseIcon
              maxWidth="md"
            />
          </div>
        );
      }

      if (!user && !hasAgentHeaders) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
            <div className="max-w-md w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6">
              <h1 className="text-lg font-semibold text-purple-700 dark:text-purple-300 mb-2">Agent access required</h1>
              <p className="text-sm text-gray-700 dark:text-gray-200 mb-4">
                You must be signed in to view this dashboard.
              </p>
              <a
                href="/agent/login"
                className="inline-flex items-center justify-center rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
              >
                Go to Agent Login
              </a>
            </div>
          </div>
        );
      }

      // Role is mandatory: block if missing or not 'agent'
      const role = user ? (user as any).role : null;
      if (user && (!role || role !== 'agent')) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
            <div className="max-w-md w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6">
              <h1 className="text-lg font-semibold text-purple-700 dark:text-purple-300 mb-2">Agent role required</h1>
              <p className="text-sm text-gray-700 dark:text-gray-200">
                Your account does not have permission to access the agent dashboard. Please ensure your role is set to agent.
              </p>
            </div>
          </div>
        );
      }
    }

    return <AgentDashboard />;
  }

  if (isEmbedSearch) {
    // Embed mode: render only the search bar so the iframe content matches the bar height
    return (
      <BusSearchBar
        onSearch={handleEmbedSearch}
        loading={loading}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        {!isEmbedSearch && (
        <header className="bg-white/80 backdrop-blur-sm shadow-sm border-b border-gray-200 sticky top-0 z-30 dark:bg-gray-950/80 dark:border-gray-800">
            <nav className="container mx-auto px-4 md:px-6">
                <div className="h-[72px] flex items-center justify-between">
                    <a
                      href={isAgentModeActive() ? '/agent-dashboard' : 'https://www.nationaltickets.co.za'}
                      className="flex items-center gap-2"
                      aria-label="National Tickets Global Home"
                    >
                      {/* Light theme logo */}
                      <img
                        src="/logo-main/natticks-logo1.png"
                        alt="National Tickets Global"
                        className="h-14 w-auto block dark:hidden"
                      />
                      {/* Dark theme logo (same file as light) */}
                      <img
                        src="/logo-main/natticks-logo1.png"
                        alt="National Tickets Global"
                        className="h-14 w-auto hidden dark:block"
                      />
                    </a>
                    
                    {/* Desktop Navigation */}
                    <div className="hidden lg:flex items-center gap-1 rounded-xl bg-gray-100/80 dark:bg-gray-800/60 p-1 border border-gray-200 dark:border-gray-700">
                        {navLinks.map((link) => (
                            <a 
                                key={link.name} 
                                href={link.href} 
                                onClick={(e) => {
                                    e.preventDefault();
                                    if (link.active) {
                                        setView('home');
                                    }
                                }}
                                className={`relative px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-200 ${
                                    link.active 
                                    ? "bg-white dark:bg-gray-900 text-[#652D8E] dark:text-purple-200 shadow-sm border border-gray-200 dark:border-gray-700 after:content-[''] after:absolute after:left-3 after:right-3 after:-bottom-1 after:h-[2px] after:rounded-full after:bg-[#652D8E] dark:after:bg-purple-400"
                                    : 'text-gray-600 hover:text-[#652D8E] hover:bg-white/70 dark:text-gray-300 dark:hover:text-purple-200 dark:hover:bg-gray-900/40'
                                }`}
                                aria-current={link.active ? 'page' : undefined}
                            >
                                {link.name}
                            </a>
                        ))}
                    </div>
                    
                    <div className="hidden lg:flex items-center gap-4">
                        <DarkModeToggle theme={theme} onToggle={toggleTheme} />
                        {user ? (
                          <div className="relative">
                            <button
                              onClick={() => setIsUserMenuOpen((v) => !v)}
                              aria-haspopup="menu"
                              aria-expanded={isUserMenuOpen}
                              className="group flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            >
                              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#652D8E] text-white dark:bg-purple-600">{userInitial}</span>
                              <span className="max-w-[180px] truncate">{userLabel}</span>
                            </button>
                            {isUserMenuOpen && (
                              <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                                <button
                                  onClick={() => { setView('dashboard'); setIsUserMenuOpen(false); }}
                                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                                >
                                  Dashboard
                                </button>
                                <button
                                  onClick={async () => { await signOut(); setIsUserMenuOpen(false); }}
                                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                                >
                                  Sign out
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setIsSignInOpen(true)}
                              className="relative overflow-hidden rounded-lg bg-transparent px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                            >
                              <span className="relative">Sign In</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsSignUpOpen(true)}
                              className="relative overflow-hidden rounded-lg bg-[#652D8E] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:bg-purple-600"
                            >
                              <span className="relative">Sign Up</span>
                            </button>
                          </div>
                        )}
                    </div>

                    {/* Mobile Menu Button */}
                    <div className="lg:hidden flex items-center gap-4">
                        <DarkModeToggle theme={theme} onToggle={toggleTheme} />
                        <button onClick={() => setIsMenuOpen(!isMenuOpen)} aria-label="Toggle menu" aria-expanded={isMenuOpen}>
                            {isMenuOpen ? <XIcon className="h-6 w-6 text-[#652D8E] dark:text-purple-300" /> : <MenuIcon className="h-6 w-6 text-[#652D8E] dark:text-purple-300" />}
                        </button>
                    </div>
                </div>

                {/* Mobile Menu */}
                {isMenuOpen && (
                    <div className="lg:hidden pb-4 animate-fade-in-down">
                        <div className="flex flex-col gap-2">
                             {navLinks.map((link) => (
                                <a 
                                    key={link.name} 
                                    href={link.href} 
                                     onClick={(e) => {
                                        e.preventDefault();
                                        if (link.active) {
                                            setView('home');
                                        }
                                        setIsMenuOpen(false); // Close menu on click
                                    }}
                                    className={`block text-base font-semibold transition-all duration-200 p-3 rounded-lg border ${
                                        link.active 
                                        ? 'bg-[#652D8E] text-white shadow-lg shadow-[#652D8E]/30 border-transparent dark:bg-purple-600' 
                                        : 'bg-white text-gray-800 hover:bg-gray-50 border-gray-200 shadow-sm hover:shadow-md dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'
                                    }`}
                                    aria-current={link.active ? 'page' : undefined}
                                >
                                    {link.name}
                                </a>
                            ))}
                            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-2">
                              {user ? (
                                <div className="flex flex-col gap-2">
                                  <button
                                    onClick={() => { setView('dashboard'); setIsMenuOpen(false); }}
                                    className="w-full text-center text-base font-semibold text-gray-700 border border-gray-300 px-4 py-2 rounded-lg bg-white hover:bg-gray-50 transition-colors dark:text-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                                  >
                                    Dashboard
                                  </button>
                                  <button
                                    onClick={async () => { await signOut(); setIsMenuOpen(false); }}
                                    className="w-full text-center text-base font-semibold text-gray-700 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800"
                                  >
                                    Sign out
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-2">
                                  <button
                                    type="button"
                                    onClick={() => { setIsSignInOpen(true); setIsMenuOpen(false); }}
                                    className="w-full text-center text-base font-semibold text-[#652D8E] border border-[#652D8E]/40 px-4 py-2 rounded-lg bg-white hover:bg-purple-50 transition-colors dark:text-purple-200 dark:bg-gray-900 dark:border-purple-500/50 dark:hover:bg-purple-950/40"
                                  >
                                    Sign In
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setIsSignUpOpen(true); setIsMenuOpen(false); }}
                                    className="w-full text-center text-base font-semibold text-white bg-[#652D8E] px-4 py-2 rounded-lg shadow-md hover:opacity-90 transition-colors dark:bg-purple-600"
                                  >
                                    Sign Up
                                  </button>
                                </div>
                              )}
                            </div>
                        </div>
                    </div>
                )}
            </nav>
        </header>
        )}

        <main className="flex-grow flex flex-col">
            {renderContent()}
        </main>

        {!isEmbedSearch && (
        <footer className="bg-white border-t border-gray-200 dark:bg-gray-950 dark:border-gray-800">
          <div className="container mx-auto py-6 px-4 md:px-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>&copy; {new Date().getFullYear()} National Tickets Global. All rights reserved.</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <a href="#" className="hover:underline">Terms &amp; Conditions</a>
              <a href="#" className="hover:underline">Privacy Notice</a>
              <a href="#" className="hover:underline">About</a>
            </div>
          </div>
        </footer>
        )}

        <FloatingSearchBar
            isOpen={isSearchEditorOpen}
            onClose={() => setIsSearchEditorOpen(false)}
            onSearch={handleSearch}
            loading={loading}
            initialQuery={currentQuery}
        />
        
        {currentBooking.outbound && currentQuery && (
          <ConfirmationModal
              isOpen={isConfirmationModalOpen}
              onClose={() => setIsConfirmationModalOpen(false)}
              onConfirm={handleConfirmBooking}
              onChangeRequested={handleChangeTripDetailsFromConfirm}
              booking={currentBooking as { outbound: BusRoute; inbound: BusRoute | null }}
              query={currentQuery}
              maxWidth="xl"
          />
        )}

        {isPaymentModalOpen && pendingBookingDetails && currentBooking.outbound && currentQuery && (
            <PaymentConfirmationModal
                isOpen={isPaymentModalOpen}
                onClose={handleCancelReview}
                onConfirm={handleFinalizeBooking}
                showInfo={showInfo}
                booking={currentBooking}
                query={currentQuery}
                details={pendingBookingDetails}
                pnr={pnr}
                maxWidth="md"
            />
        )}

        <LoadingModal 
          isOpen={showLoadingModal}
          progress={loadingProgress}
          steps={loadingSteps}
          title={loadingTitle}
          subtitle={loadingSubtitle}
          maxWidth="md"
        />

        <ErrorModal 
          isOpen={errorModalOpen}
          onClose={handleErrorModalClose}
          title={errorModalTitle}
          message={errorModalMessage}
          details={errorModalDetails}
          variant={errorModalVariant}
          errorType={errorModalType}
          showTechnicalDetailsToggle={false}
          primaryActionLabel={errorModalPrimaryActionLabel}
          onPrimaryAction={errorModalPrimaryAction}
          maxWidth="xl"
        />

        <ErrorModal
          isOpen={priceUpdateModalOpen}
          onClose={handleAcknowledgePriceUpdate}
          title="Price updated"
          message="We refreshed your total to match the latest availability. Please review the update and accept to continue."
          body={(() => {
            if (!pendingPriceUpdate) return null;
            const prefix = pendingPriceUpdate.currency === 'USD' ? '$' : `${pendingPriceUpdate.currency} `;
            const delta = pendingPriceUpdate.finalTotal - pendingPriceUpdate.quoted;
            const isIncrease = delta > 0.009;
            const absDelta = Math.abs(delta);

            return (
              <div className="rounded-lg border border-purple-200/80 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/90 to-white dark:from-purple-900/15 dark:to-gray-900/10 p-3">
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 rounded-lg bg-white/90 dark:bg-gray-900/20 border border-purple-100 dark:border-purple-800/30 p-2.5">
                    <div className="flex items-center text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                      <PriceTagIcon className="h-4 w-4 text-[#652D8E] mr-1.5" />
                      Quoted total
                    </div>
                    <div className="mt-1 text-lg font-extrabold text-gray-900 dark:text-white">
                      {prefix}{pendingPriceUpdate.quoted.toFixed(2)}
                    </div>
                  </div>

                  <div className="flex items-center justify-center px-1">
                    <ArrowRightIcon className="h-5 w-5 text-[#652D8E]" />
                  </div>

                  <div className="flex-1 rounded-lg bg-white/90 dark:bg-gray-900/20 border border-purple-100 dark:border-purple-800/30 p-2.5">
                    <div className="flex items-center text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                      <PriceTagIcon className="h-4 w-4 text-[#652D8E] mr-1.5" />
                      Updated total
                    </div>
                    <div className="mt-1 text-lg font-extrabold text-gray-900 dark:text-white">
                      {prefix}{pendingPriceUpdate.finalTotal.toFixed(2)}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center rounded-full bg-[#652D8E]/10 dark:bg-purple-900/30 px-2.5 py-1 text-[11px] font-bold text-[#652D8E] dark:text-purple-200">
                    {isIncrease ? (
                      <PlusIcon className="h-3.5 w-3.5 mr-1.5" />
                    ) : (
                      <MinusIcon className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {isIncrease ? 'Increased' : 'Decreased'} by {prefix}{absDelta.toFixed(2)}
                  </span>

                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    This ensures your payment matches the provider’s latest price.
                  </span>
                </div>
              </div>
            );
          })()}
          variant="info"
          primaryActionLabel="Continue"
          onPrimaryAction={handleAcknowledgePriceUpdate}
          maxWidth="md"
          hideCloseButton
          hideCloseIcon
        />

        <Toast
          isOpen={toastOpen}
          title={toastTitle}
          message={toastMessage}
          variant={toastVariant}
          onClose={() => setToastOpen(false)}
        />

        <SignInModal
          isOpen={isSignInOpen}
          onClose={() => setIsSignInOpen(false)}
          maxWidth="md"
        />

        <SignUpModal
          isOpen={isSignUpOpen}
          onClose={() => setIsSignUpOpen(false)}
          maxWidth="md"
        />
    </div>
  );
}

export default App;