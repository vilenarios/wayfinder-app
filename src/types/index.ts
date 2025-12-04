export type RoutingStrategy = 'random' | 'fastest' | 'roundRobin' | 'preferred';

export type VerificationMethod = 'hash' | 'signature';

export interface WayfinderConfig {
  routingStrategy: RoutingStrategy;
  preferredGateway?: string;
  telemetryEnabled: boolean;
  verificationEnabled: boolean;
  /** When true, blocks content display if verification fails (requires user confirmation) */
  strictVerification: boolean;
  /** Number of parallel resource verifications (1-20, default 10) */
  verificationConcurrency: number;
  /** Verification method: 'hash' (fast) or 'signature' (cryptographic, most secure) */
  verificationMethod: VerificationMethod;
  /** Number of trusted gateways to use for verification (1-10, default 3) */
  trustedGatewayCount: number;
}

/** Gateway info with stake for display purposes */
export interface GatewayWithStake {
  url: string;
  totalStake: number;
}

export interface WayfinderConfigContextValue {
  config: WayfinderConfig;
  updateConfig: (config: Partial<WayfinderConfig>) => void;
}

export type InputType = 'txId' | 'arnsName';
