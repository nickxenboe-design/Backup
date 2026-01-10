import React, { useState, useEffect } from "react";
import { BusRoute, SearchQuery, pollTrips } from "../utils/api";
import BusResultCard from "./BusResultCard";

interface BusSearchResultsProps {
  searchId: string;
  onSelectRoute?: (route: BusRoute) => void;
  searchQuery?: SearchQuery;
}

const BusSearchResults: React.FC<BusSearchResultsProps> = ({ searchId, onSelectRoute, searchQuery }) => {
  const [trips, setTrips] = useState<BusRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const handleTripSelection = async (route: BusRoute) => {
    // Use centralized trip selection logic from parent component
    if (onSelectRoute) {
      await onSelectRoute(route);
    }
  };

  useEffect(() => {
    let isMounted = true;
    let intervalId: NodeJS.Timeout | null = null;

    const startPolling = async () => {
      setLoading(true);
      setError(null);
      setTrips([]);
      setPollCount(0);

      const MAX_POLLS = 15; // stop after 15 attempts (~30s)
      const POLL_INTERVAL = 2000; // every 2 seconds

      const fetchData = async () => {
        try {
          const newTrips = await pollTrips(searchId);

          if (!isMounted) return;

          if (newTrips && newTrips.length > 0) {
            setTrips((prevTrips) => {
              // Avoid duplicates
              const existingIds = new Set(prevTrips.map((t) => t.id));
              const combined = [...prevTrips];

              newTrips.forEach((trip) => {
                if (!existingIds.has(trip.id)) {
                  combined.push(trip);
                }
              });

              return combined;
            });
          }

          setPollCount((prev) => prev + 1);

          // Stop polling if data is ready or attempts exceed limit
          if (newTrips.length > 0 && newTrips.every((t) => t.operator !== "Unknown Operator")) {
            clearInterval(intervalId!);
            setLoading(false);
          } else if (pollCount >= MAX_POLLS) {
            clearInterval(intervalId!);
            setLoading(false);
          }
        } catch (err: any) {
          if (!isMounted) return;
          setError(err.message || "Failed to fetch trips");
          clearInterval(intervalId!);
          setLoading(false);
        }
      };

      // First call immediately, then set interval
      await fetchData();
      intervalId = setInterval(fetchData, POLL_INTERVAL);
    };

    startPolling();

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [searchId]);

  // UI States
  if (loading && trips.length === 0) return <p>🔄 Searching for available trips...</p>;
  if (error) return <p className="text-red-500">❌ Error: {error}</p>;
  if (!loading && trips.length === 0) return <p>No trips found for this search.</p>;

  return (
    <div className="space-y-4">
      {loading && trips.length > 0 && (
        <p className="text-gray-500 text-sm italic">
          Fetching more trip options... ({pollCount})
        </p>
      )}

      {trips.map((trip) => (
        <BusResultCard
          key={trip.id}
          route={trip}
          searchQuery={searchQuery!}
          deferApiCall={typeof trip?.id === 'string' && trip.id.startsWith('eagleliner:')}
          onTripSelected={(tripId) => handleTripSelection(trip)}
        />
      ))}

      {!loading && trips.length > 0 && (
        <p className="text-green-600 text-sm mt-2">✅ All trips loaded.</p>
      )}
    </div>
  );
};

export default BusSearchResults;
