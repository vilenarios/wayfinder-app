export type RoutingStrategy = 'random' | 'fastest' | 'roundRobin' | 'preferred';

export interface WayfinderConfig {
  routingStrategy: RoutingStrategy;
  preferredGateway?: string;
  telemetryEnabled: boolean;
}

export interface WayfinderConfigContextValue {
  config: WayfinderConfig;
  updateConfig: (config: Partial<WayfinderConfig>) => void;
}

export type InputType = 'txId' | 'arnsName';
