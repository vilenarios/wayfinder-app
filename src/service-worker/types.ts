export interface ArweaveManifest {
  manifest: 'arweave/paths';
  version: string;
  index?: { path: string };
  paths: Record<string, ManifestPath>;
  fallback?: { id: string };
}

export interface ManifestPath {
  id: string;
}

export interface IframeContext {
  manifestTxId: string;
  basePath: string;
  depth: number; // Track nesting level
  parentContext?: string; // For nested manifests
}

export interface VerificationEvent {
  type: 'verification-started' | 'verification-progress' | 'verification-success' | 'verification-failed';
  txId: string;
  resourcePath?: string;
  progress?: {
    current: number;
    total: number;
  };
  error?: string;
}

export interface WayfinderConfig {
  /** Top-staked gateways used for hash verification */
  trustedGateways: string[];
  /** Broader pool of gateways used for content routing/fetching */
  routingGateways?: string[];
  routingStrategy: string;
  preferredGateway?: string;
  enabled: boolean;
}
