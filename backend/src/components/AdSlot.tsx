import React from 'react';

export interface AdDefinition {
  id: string;
  label: string;
  title: string;
  description: string;
  href: string;
  ctaLabel?: string;
  imageDataUrl?: string;
}

interface AdSlotProps {
  slotId?: number;
}

const ADS_STORAGE_KEY = 'ntg_ads_config';

const ADS: AdDefinition[] = [
  {
    id: 'travel-insurance',
    label: 'Sponsored',
    title: 'Protect your trip with travel insurance',
    description: 'Cover cancellations, lost luggage and medical emergencies for your next journey.',
    href: '#',
    ctaLabel: 'Learn more',
  },
  {
    id: 'hotel-deals',
    label: 'Ad',
    title: 'Save on hotels near your destination',
    description: 'Compare trusted partners and find stays walking distance from the bus station.',
    href: '#',
    ctaLabel: 'View deals',
  },
  {
    id: 'loyalty-program',
    label: 'Ad',
    title: 'Earn rewards on every trip',
    description: 'Join the National Tickets Global rewards program and unlock member-only discounts.',
    href: '#',
    ctaLabel: 'Join now',
  },
];

export const getConfiguredAds = (): AdDefinition[] => {
  if (typeof window === 'undefined') {
    return ADS;
  }
  try {
    const raw = window.localStorage.getItem(ADS_STORAGE_KEY);
    if (!raw) return ADS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((item) => item && typeof item.title === 'string' && typeof item.href === 'string') as AdDefinition[];
    }
    return ADS;
  } catch {
    return ADS;
  }
};

export const saveConfiguredAds = (ads: AdDefinition[]) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(ADS_STORAGE_KEY, JSON.stringify(ads));
  } catch {
  }
};

const AdSlot: React.FC<AdSlotProps> = ({ slotId }) => {
  const ads = getConfiguredAds();
  const index = typeof slotId === 'number' && slotId >= 0 && slotId < ads.length
    ? slotId
    : Math.floor(Math.random() * ads.length);

  const ad = ads[index] || ADS[0];
  const hasImage = !!ad.imageDataUrl;

  return (
    <a
      href={ad.href}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 overflow-hidden block no-underline hover:border-[#652D8E] dark:hover:border-purple-400 hover:bg-white/80 dark:hover:bg-gray-900 transition-colors"
    >
      {hasImage ? (
        <img
          src={ad.imageDataUrl as string}
          alt={ad.title}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-16 bg-gray-100 dark:bg-gray-800" />
      )}
    </a>
  );
};

export default AdSlot;
