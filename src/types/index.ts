export type RoutingStrategy = 'random' | 'fastest' | 'roundRobin' | 'preferred';

export interface WayfinderConfig {
  routingStrategy: RoutingStrategy;
  preferredGateway?: string;
  telemetryEnabled: boolean;
  verificationEnabled: boolean;
  /** When true, blocks content display if verification fails (requires user confirmation) */
  strictVerification: boolean;
}

export interface WayfinderConfigContextValue {
  config: WayfinderConfig;
  updateConfig: (config: Partial<WayfinderConfig>) => void;
}

export type InputType = 'txId' | 'arnsName';
