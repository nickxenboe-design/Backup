import React from 'react';

const BusResultCardSkeleton: React.FC = () => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden relative">
      <div className="p-4 md:p-5 grid grid-cols-12 gap-4 items-center">
        {/* Shimmer Effect */}
        <div className="absolute inset-0 shimmer -translate-x-full z-10"></div>
        
        {/* Company & Amenities Skeleton */}
        <div className="col-span-12 md:col-span-3 border-b md:border-b-0 md:border-r border-gray-200/80 dark:border-gray-700 pb-4 md:pb-0 md:pr-4 flex flex-col justify-between h-full min-h-[60px]">
          <div className="h-5 w-3/4 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
          <div className="flex items-center gap-3 mt-3">
            <div className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>

        {/* Journey Details Skeleton */}
        <div className="col-span-12 md:col-span-6 flex items-center">
          <div className="flex-1 text-left">
            <div className="h-7 w-24 bg-gray-300 dark:bg-gray-600 rounded-md mb-1.5"></div>
            <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="h-4 w-12 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
          </div>
          <div className="flex-1 text-right">
            <div className="h-7 w-24 bg-gray-300 dark:bg-gray-600 rounded-md mb-1.5 ml-auto"></div>
            <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded-md ml-auto"></div>
          </div>
        </div>

        {/* Price & CTA Skeleton */}
        <div className="col-span-12 md:col-span-3 md:border-l border-gray-200/80 dark:border-gray-700 md:pl-4 flex flex-row md:flex-col items-center justify-between md:justify-center md:items-end h-full">
          <div className="h-7 w-20 rounded-md bg-gray-300 dark:bg-gray-600 mb-2"></div>
          <div className="h-10 w-28 rounded-lg bg-gray-300 dark:bg-gray-600"></div>
        </div>
      </div>
    </div>
  );
};

export default BusResultCardSkeleton;