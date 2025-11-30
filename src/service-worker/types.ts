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

/**
 * State of manifest verification for an identifier (ArNS name or txId)
 */
export interface ManifestVerificationState {
  identifier: string;           // Original ArNS name or txId requested
  manifestTxId: string;         // Resolved manifest transaction ID
  status: 'resolving' | 'fetching-manifest' | 'verifying' | 'complete' | 'partial' | 'failed';
  manifest: ArweaveManifest | null;
  totalResources: number;
  verifiedResources: number;
  failedResources: string[];    // List of txIds that failed verification
  pathToTxId: Map<string, string>;  // path → txId mapping for serving
  indexPath: string;            // The index path from manifest (e.g., "index.html")
  routingGateway?: string;      // Gateway used for fetching
  error?: string;
  startedAt: number;
  completedAt?: number;
}

/**
 * Result of checking if content is a manifest
 */
export interface ManifestCheckResult {
  isManifest: boolean;
  manifest?: ArweaveManifest;
  rawData?: ArrayBuffer;
  contentType?: string;
}

export interface VerificationEvent {
  type:
    | 'verification-started'      // Started resolving/fetching manifest
    | 'manifest-loaded'           // Manifest parsed, know total resources
    | 'verification-progress'     // Resource verified, progress update
    | 'verification-complete'     // All resources verified
    | 'verification-failed'       // Verification failed
    | 'routing-gateway';          // Gateway info for display
  identifier: string;             // ArNS name or txId being verified
  manifestTxId?: string;          // Resolved manifest txId
  resourcePath?: string;          // Current resource being verified
  progress?: {
    current: number;
    total: number;
  };
  error?: string;
  gatewayUrl?: string;
}

// Keep old txId field for backwards compatibility
export type { VerificationEvent as LegacyVerificationEvent };

export interface WayfinderConfig {
  /** Top-staked gateways used for hash verification */
  trustedGateways: string[];
  /** Broader pool of gateways used for content routing/fetching */
  routingGateways?: string[];
  routingStrategy: string;
  preferredGateway?: string;
  enabled: boolean;
  /** When true, blocks content if verification fails */
  strict: boolean;
  /** Number of parallel resource verifications (1-20, default 10) */
  concurrency?: number;
}
