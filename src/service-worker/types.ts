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
  trustedGateways: string[];
  routingStrategy: string;
  preferredGateway?: string;
  enabled: boolean;
}
