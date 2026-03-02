import base32Encode from 'base32-encode';

/**
 * Convert a transaction ID to its sandbox subdomain URL.
 *
 * AR.IO gateways use sandbox subdomains for content isolation.
 * The subdomain is the base32-encoded (lowercase, no padding) version
 * of the transaction ID.
 *
 * Example:
 * txId: yWGUAgigrAB_5s-vGu-OZU2NZdu0YNhVdpFfCfsWHcA
 * subdomain: zfqziaqiucwaa77gz6xrv34omvgy2zo3wrqnqvlwsfpqt6ywdxaa
 *
 * @param txId - The Arweave transaction ID
 * @param gatewayUrl - The base gateway URL (e.g., https://turbo-gateway.com)
 * @returns The full sandbox URL
 */
export function getSandboxUrl(txId: string, gatewayUrl: string): string {
  // Convert txId to bytes (base64url decode)
  const txIdBytes = base64UrlToBytes(txId);

  // Encode to base32 (lowercase, no padding)
  const subdomain = base32Encode(txIdBytes, 'RFC4648', { padding: false }).toLowerCase();

  // Extract hostname from gateway URL
  const gateway = new URL(gatewayUrl);
  const hostname = gateway.hostname;

  // Construct sandbox URL: https://{base32-txid}.{gateway-host}/{txid}
  return `https://${subdomain}.${hostname}/${txId}`;
}

/**
 * Decode a base64url-encoded string to bytes.
 * Arweave transaction IDs use base64url encoding.
 */
function base64UrlToBytes(base64url: string): Uint8Array {
  // Convert base64url to base64
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Add padding if needed
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');

  // Decode base64 to binary string
  const binaryString = atob(padded);

  // Convert binary string to Uint8Array
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}
