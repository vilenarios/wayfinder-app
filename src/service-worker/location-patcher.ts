/**
 * Location Patcher for Verified Content
 *
 * Apps loaded via /ar-proxy/{identifier}/ see a different window.location
 * than they would if loaded directly from a gateway subdomain.
 *
 * This module injects a script into HTML responses that patches window.location
 * to make the app think it's running at {identifier}.{gateway-host}
 */

import { logger } from './logger';

const TAG = 'LocationPatcher';

/**
 * Create the location patching script.
 * This script overrides window.location properties to simulate
 * the app running at the gateway subdomain.
 */
function createLocationPatchScript(identifier: string, gatewayUrl: string): string {
  // Parse the gateway URL to get the host
  let gatewayHost: string;
  try {
    gatewayHost = new URL(gatewayUrl).host;
  } catch {
    // Fallback if URL parsing fails
    gatewayHost = 'arweave.net';
  }

  // Build the simulated origin
  const simulatedHost = `${identifier}.${gatewayHost}`;
  const simulatedOrigin = `https://${simulatedHost}`;

  // The script to inject - runs before any app code
  return `<script data-wayfinder-location-patch>
(function() {
  // Simulated location values
  const SIM_HOST = '${simulatedHost}';
  const SIM_HOSTNAME = SIM_HOST.split(':')[0];
  const SIM_ORIGIN = '${simulatedOrigin}';
  const PROXY_PREFIX = '/ar-proxy/${identifier}';

  // Store original location descriptor
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  const originalLocation = window.location;

  // Helper to strip proxy prefix from pathname
  function getSimulatedPathname() {
    const path = originalLocation.pathname;
    if (path.startsWith(PROXY_PREFIX)) {
      const stripped = path.slice(PROXY_PREFIX.length);
      return stripped || '/';
    }
    return path;
  }

  // Helper to build simulated href
  function getSimulatedHref() {
    const pathname = getSimulatedPathname();
    const search = originalLocation.search;
    const hash = originalLocation.hash;
    return SIM_ORIGIN + pathname + search + hash;
  }

  // Create a proxy that intercepts location property access
  const locationProxy = new Proxy(originalLocation, {
    get(target, prop, receiver) {
      switch (prop) {
        case 'host':
          return SIM_HOST;
        case 'hostname':
          return SIM_HOSTNAME;
        case 'origin':
          return SIM_ORIGIN;
        case 'pathname':
          return getSimulatedPathname();
        case 'href':
          return getSimulatedHref();
        case 'protocol':
          return 'https:';
        case 'port':
          return '';
        case 'toString':
          return function() { return getSimulatedHref(); };
        case 'valueOf':
          return function() { return getSimulatedHref(); };
        default:
          // For methods like assign, replace, reload - use original
          const value = Reflect.get(target, prop, receiver);
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
      }
    },
    set(target, prop, value) {
      // Allow setting properties like href (for navigation)
      return Reflect.set(target, prop, value);
    }
  });

  // Override window.location
  try {
    Object.defineProperty(window, 'location', {
      get() { return locationProxy; },
      set(value) {
        // Handle location = 'url' (navigation)
        originalLocation.href = value;
      },
      configurable: true
    });
  } catch (e) {
    // Some browsers may not allow this
    console.warn('[Wayfinder] Could not patch window.location:', e);
  }

  // Also patch document.location (it's the same as window.location)
  try {
    Object.defineProperty(document, 'location', {
      get() { return locationProxy; },
      set(value) {
        originalLocation.href = value;
      },
      configurable: true
    });
  } catch (e) {
    // Ignore if we can't patch document.location
  }
})();
</script>`;
}

/**
 * Inject location patch into HTML content.
 * Returns the modified HTML with the patch script injected.
 */
export function injectLocationPatch(
  html: string,
  identifier: string,
  gatewayUrl: string
): string {
  const patchScript = createLocationPatchScript(identifier, gatewayUrl);

  // Try to inject right after <head> tag
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    const insertPos = headMatch.index! + headMatch[0].length;
    const result = html.slice(0, insertPos) + patchScript + html.slice(insertPos);
    logger.debug(TAG, `Injected location patch for ${identifier}`);
    return result;
  }

  // Fallback: inject at the start of <html> content
  const htmlMatch = html.match(/<html[^>]*>/i);
  if (htmlMatch) {
    const insertPos = htmlMatch.index! + htmlMatch[0].length;
    const result = html.slice(0, insertPos) + patchScript + html.slice(insertPos);
    logger.debug(TAG, `Injected location patch for ${identifier} (after html tag)`);
    return result;
  }

  // Last resort: prepend to document
  logger.warn(TAG, `Could not find injection point, prepending patch for ${identifier}`);
  return patchScript + html;
}

/**
 * Check if content type is HTML.
 */
export function isHtmlContent(contentType: string): boolean {
  return contentType.toLowerCase().includes('text/html');
}
