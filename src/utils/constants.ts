import type { WayfinderConfig } from '../types';

export const STORAGE_KEY = 'wayfinder-app-config';

export const DEFAULT_CONFIG: WayfinderConfig = {
  routingStrategy: 'random',
  telemetryEnabled: false,
};

export const ROUTING_STRATEGY_OPTIONS = [
  {
    value: 'random' as const,
    label: 'Random',
    description: 'Randomly select a gateway for load balancing',
  },
  {
    value: 'fastest' as const,
    label: 'Fastest Ping',
    description: 'Test latency and use the fastest gateway (cached 5 min)',
  },
  {
    value: 'roundRobin' as const,
    label: 'Round Robin',
    description: 'Cycle through gateways sequentially',
  },
  {
    value: 'preferred' as const,
    label: 'Preferred Gateway',
    description: 'Use a specific gateway with fallback',
  },
] as const;
