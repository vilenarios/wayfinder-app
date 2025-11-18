interface LoadingSpinnerProps {
  message?: string;
}

export function LoadingSpinner({ message = 'Loading...' }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-4 md:p-8 bg-container-L1">
      <div className="relative w-12 h-12 md:w-16 md:h-16">
        <div className="absolute inset-0 border-4 border-container-L3 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-accent-teal-primary rounded-full border-t-transparent animate-spin"></div>
      </div>
      <p className="text-text-low text-sm md:text-base text-center px-4">{message}</p>
    </div>
  );
}
