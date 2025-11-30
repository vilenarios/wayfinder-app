export type RoutingStrategy = 'random' | 'fastest' | 'roundRobin' | 'preferred';

export interface WayfinderConfig {
  routingStrategy: RoutingStrategy;
  preferredGateway?: string;
  telemetryEnabled: boolean;
  verificationEnabled: boolean;
  /** When true, blocks content display if verification fails (requires user confirmation) */
  strictVerification: boolean;
  /** Number of parallel resource verifications (1-20, default 10) */
  verificationConcurrency: number;
}

export interface WayfinderConfigContextValue {
  config: WayfinderConfig;
  updateConfig: (config: Partial<WayfinderConfig>) => void;
}

export type InputType = 'txId' | 'arnsName';
