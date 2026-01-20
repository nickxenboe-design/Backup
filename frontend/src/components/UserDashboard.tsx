import React, { useEffect, useState } from 'react';
import { Box, Paper, Typography, Button, TextField, List, ListItem, ListItemText, Chip, Alert } from '@mui/material';
import type { AuthUser } from '../contexts/AuthContext';
import { getCartData, getPurchaseData, timestampToLocaleDateTime, getTicketsByCart } from '../utils/api';
import type { CartSessionData, PurchaseSessionData } from '../utils/api';
import MyBookings from './MyBookings';

type DashboardTicket = {
  id: string;
  status: string;
  updatedAt: string;
  options?: any;
};

const PROFILE_STORAGE_KEY = 'natticks_profile_overrides';

const getDashboardTicketReference = (ticket: DashboardTicket): string | null => {
  const options = ticket && ticket.options && typeof ticket.options === 'object' ? (ticket.options as any) : ({} as any);
  const keys = ['pnr', 'PNR', 'reference', 'referenceNumber', 'bookingReference', 'ticketNumber', 'ticketNo'];
  for (const key of keys) {
    const value = (options as any)[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
};

type UserDashboardProps = {
  user: AuthUser;
  onViewTickets?: (cartId: string, ticketId?: string) => void;
  onStartNewBooking?: () => void;
};

const UserDashboard: React.FC<UserDashboardProps> = ({ user, onViewTickets, onStartNewBooking }) => {
  const [cart, setCart] = useState<CartSessionData | null>(null);
  const [purchase, setPurchase] = useState<PurchaseSessionData | null>(null);
  const [tickets, setTickets] = useState<DashboardTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      setCart(getCartData());
    } catch {}
    try {
      setPurchase(getPurchaseData());
    } catch {}
  }, []);

  useEffect(() => {
    if (!user || !cart || !cart.cartId) return;

    let cancelled = false;

    const loadTickets = async () => {
      setTicketsLoading(true);
      setTicketsError(null);
      try {
        const res: any = await getTicketsByCart(cart.cartId!);
        if (cancelled) return;
        if (res && res.success && Array.isArray(res.tickets)) {
          setTickets(res.tickets as DashboardTicket[]);
        } else if (res && !res.success && res.message) {
          setTicketsError(String(res.message));
        }
      } catch (e: any) {
        if (!cancelled) {
          setTicketsError(e?.message || 'Failed to load tickets');
        }
      } finally {
        if (!cancelled) {
          setTicketsLoading(false);
        }
      }
    };

    loadTickets();

    return () => {
      cancelled = true;
    };
  }, [user, cart]);

  useEffect(() => {
    let initialName =
      (typeof user?.name === 'string' && user.name) ||
      (typeof user?.displayName === 'string' && user.displayName) ||
      (typeof user?.email === 'string' && user.email) ||
      '';
    let initialPhone = '';

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as any;
          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
              initialName = parsed.name;
            }
            if (typeof parsed.phone === 'string') {
              initialPhone = parsed.phone;
            }
          }
        }
      } catch {}
    }

    setProfileName(initialName);
    setProfilePhone(initialPhone);
  }, [user]);

  const handleSaveProfile = (event: React.FormEvent) => {
    event.preventDefault();
    setProfileSaving(true);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const payload = {
          name: profileName,
          phone: profilePhone
        };
        window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(payload));
      }
      setProfileMessage('Profile updated');
      window.setTimeout(() => {
        setProfileMessage(null);
      }, 3000);
    } catch {}
    setProfileSaving(false);
  };

  if (!user) {
    return (
      <Box maxWidth="md" mx="auto">
        <Paper elevation={1} sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h5" fontWeight={700} gutterBottom>
            Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            You need to be signed in to view your dashboard.
          </Typography>
        </Paper>
      </Box>
    );
  }

  const displayName =
    (profileName && profileName.trim().length > 0 && profileName) ||
    (typeof user.name === 'string' && user.name) ||
    (typeof user.displayName === 'string' && user.displayName) ||
    (typeof user.email === 'string' && user.email) ||
    'Traveler';

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 3 }}>
      <Box
        component="aside"
        sx={{ width: { xs: '100%', lg: 260 }, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="overline" color="text.secondary">
            Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Quick overview of your account and trips.
          </Typography>
          <Typography variant="overline" color="text.secondary" sx={{ mt: 3 }}>
            Signed in as
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, wordBreak: 'break-all' }}>
            {user.email || 'No email on file'}
          </Typography>
          {user.role && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              Role: {String(user.role)}
            </Typography>
          )}
          <Chip
            label="Logged in"
            size="small"
            sx={{
              mt: 2,
              fontWeight: 600,
              alignSelf: 'flex-start',
              bgcolor: '#F3E8FF',
              color: '#652D8E',
            }}
          />
        </Paper>

        <Paper sx={{ p: 2.5 }}>
          <Typography variant="overline" color="text.secondary">
            Sections
          </Typography>
          <List dense sx={{ mt: 1 }}>
            <ListItem disableGutters>
              <Button
                type="button"
                fullWidth
                size="small"
                onClick={() => {
                  const el = document.getElementById('my-profile');
                  if (el && typeof el.scrollIntoView === 'function') {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
                sx={{
                  justifyContent: 'flex-start',
                  textTransform: 'none',
                  color: '#652D8E',
                  '&:hover': {
                    backgroundColor: 'rgba(101,45,142,0.04)',
                  },
                }}
              >
                My profile
              </Button>
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="Overview" primaryTypographyProps={{ variant: 'body2' }} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="Recent tickets" primaryTypographyProps={{ variant: 'body2' }} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="My bookings" primaryTypographyProps={{ variant: 'body2' }} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="Next steps" primaryTypographyProps={{ variant: 'body2' }} />
            </ListItem>
          </List>
        </Paper>
      </Box>

      <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { md: 'center' },
            justifyContent: { md: 'space-between' },
            gap: 2,
          }}
        >
          <Box>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              Welcome back, {displayName}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This is your personal dashboard. In the future you will be able to see your upcoming and past trips here.
            </Typography>
          </Box>
        </Box>

        <Paper id="my-profile" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            My profile
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
            Edit the personal details associated with your account.
          </Typography>
          <Box
            component="form"
            onSubmit={handleSaveProfile}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <TextField
              label="Name"
              size="small"
              fullWidth
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
            <TextField
              label="Phone number"
              size="small"
              fullWidth
              value={profilePhone}
              onChange={(e) => setProfilePhone(e.target.value)}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button
                type="submit"
                variant="contained"
                size="small"
                disabled={profileSaving}
                sx={{
                  backgroundColor: '#652D8E',
                  '&:hover': {
                    backgroundColor: '#4E2270',
                  },
                }}
              >
                {profileSaving ? 'Saving...' : 'Save changes'}
              </Button>
              {profileMessage && (
                <Typography variant="caption" color="success.main">
                  {profileMessage}
                </Typography>
              )}
            </Box>
          </Box>
        </Paper>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="overline" color="text.secondary">
              Account
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {user.email || 'No email on file'}
            </Typography>
            {user.role && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                Role: {String(user.role)}
              </Typography>
            )}
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Typography variant="overline" color="text.secondary">
              Latest booking
            </Typography>
            {cart ? (
              <>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Reference / PNR:{' '}
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                  >
                    {purchase?.pnr || cart.cartId || 'Not available'}
                  </Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  Created: {timestampToLocaleDateTime(cart.timestamp)}
                </Typography>
                {onViewTickets && cart.cartId && (
                  <Button
                    type="button"
                    variant="outlined"
                    size="small"
                    sx={{
                      mt: 1.5,
                      borderColor: '#652D8E',
                      color: '#652D8E',
                      '&:hover': {
                        borderColor: '#4E2270',
                        backgroundColor: 'rgba(101,45,142,0.04)',
                      },
                    }}
                    onClick={() => onViewTickets(cart.cartId!)}
                  >
                    View tickets
                  </Button>
                )}
              </>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Trip history is not available yet. After your next booking, this section will show your upcoming
                journeys.
              </Typography>
            )}
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Typography variant="overline" color="text.secondary">
              Saved details
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Use the booking form to enter passenger details. In future versions we can reuse them here for faster
              checkout.
            </Typography>
          </Paper>
        </Box>

        {cart?.cartId && (
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              Recent tickets
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Showing tickets for your latest booking.
            </Typography>
            {ticketsLoading && (
              <Typography variant="caption" color="text.secondary">
                Loading tickets...
              </Typography>
            )}
            {ticketsError && !ticketsLoading && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {ticketsError}
              </Alert>
            )}
            {!ticketsLoading && !ticketsError && tickets.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No tickets have been issued yet for this booking.
              </Typography>
            )}
            {!ticketsLoading && !ticketsError && tickets.length > 0 && (
              <List dense sx={{ mt: 1 }}>
                {tickets.slice(0, 3).map((t) => (
                  <ListItem
                    key={t.id}
                    sx={{
                      mb: 0.5,
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      px: 1.5,
                      py: 1,
                    }}
                    secondaryAction={
                      onViewTickets && (
                        <Button
                          size="small"
                          variant="contained"
                          sx={{
                            backgroundColor: '#652D8E',
                            '&:hover': {
                              backgroundColor: '#4E2270',
                            },
                          }}
                          onClick={() => onViewTickets(cart.cartId!, t.id)}
                        >
                          View
                        </Button>
                      )
                    }
                  >
                    <ListItemText
                      primary={getDashboardTicketReference(t) || t.id}
                      primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                      secondary={
                        <>
                          <Typography variant="caption" component="span">
                            Status: <strong>{t.status}</strong>
                          </Typography>
                          <br />
                          <Typography variant="caption" color="text.secondary" component="span">
                            Updated: {new Date(t.updatedAt).toLocaleString()}
                          </Typography>
                        </>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        )}

        <Box>
          <MyBookings
            onViewTickets={onViewTickets ? (cartId: string) => onViewTickets(cartId) : undefined}
            showHeader={false}
          />
        </Box>

        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            Next steps
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Use the search bar at the top of the page to plan a new trip, or return to this dashboard anytime from the
            account menu.
          </Typography>
          <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {onStartNewBooking && (
              <Button
                type="button"
                variant="contained"
                size="small"
                onClick={onStartNewBooking}
                sx={{
                  backgroundColor: '#652D8E',
                  '&:hover': {
                    backgroundColor: '#4E2270',
                  },
                }}
              >
                Book a new trip
              </Button>
            )}
            {onViewTickets && cart?.cartId && (
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={() => onViewTickets(cart.cartId!)}
                sx={{
                  borderColor: '#652D8E',
                  color: '#652D8E',
                  '&:hover': {
                    borderColor: '#4E2270',
                    backgroundColor: 'rgba(101,45,142,0.04)',
                  },
                }}
              >
                View latest tickets
              </Button>
            )}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default UserDashboard;
