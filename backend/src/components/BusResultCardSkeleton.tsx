import React from 'react';

const BusResultCardSkeleton: React.FC = () => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden relative">
      <div className="p-3 md:p-4 grid grid-cols-12 gap-3 items-center">
        {/* Shimmer Effect */}
        <div className="absolute inset-0 shimmer -translate-x-full z-10"></div>
        
        {/* Company & Amenities Skeleton */}
        <div className="col-span-12 md:col-span-3 border-b md:border-b-0 md:border-r border-gray-200/80 dark:border-gray-700 pb-3 md:pb-0 md:pr-3 flex flex-col justify-between h-full min-h-[60px]">
          <div className="h-4 w-2/3 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
          <div className="flex items-center gap-2 mt-2">
            <div className="h-5 w-5 bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-5 w-5 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>

        {/* Journey Details Skeleton */}
        <div className="col-span-12 md:col-span-6 flex items-center">
          <div className="flex-1 text-left">
            <div className="h-5 w-20 bg-gray-300 dark:bg-gray-600 rounded-md mb-1"></div>
            <div className="h-2.5 w-16 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="h-3 w-10 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
          </div>
          <div className="flex-1 text-right">
            <div className="h-5 w-20 bg-gray-300 dark:bg-gray-600 rounded-md mb-1 ml-auto"></div>
            <div className="h-2.5 w-16 bg-gray-200 dark:bg-gray-700 rounded-md ml-auto"></div>
          </div>
        </div>

        {/* Price & CTA Skeleton */}
        <div className="col-span-12 md:col-span-3 md:border-l border-gray-200/80 dark:border-gray-700 md:pl-3 flex flex-row md:flex-col items-center justify-between md:justify-center md:items-end h-full">
          <div className="h-5 w-16 rounded-md bg-gray-300 dark:bg-gray-600 mb-2"></div>
          <div className="h-8 w-24 rounded-lg bg-gray-300 dark:bg-gray-600"></div>
        </div>
      </div>
    </div>
  );
};

export default BusResultCardSkeleton;