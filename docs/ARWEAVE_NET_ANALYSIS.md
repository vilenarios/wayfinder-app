# arweave.net Dependency Analysis

**Date**: 2026-03-02
**Issue**: arweave.net is no longer an AR.IO gateway and does not support AR.IO-specific APIs

## Executive Summary

The codebase has **critical dependencies** on arweave.net providing AR.IO gateway APIs (specifically `/ar-io/peers`). Testing confirms that arweave.net returns 404 for this endpoint, meaning the app's gateway fetching system is currently broken when relying on arweave.net.

```bash
$ curl -s "https://arweave.net/ar-io/peers"
# Returns 404 - Page not found
```

## Critical Issues Found

### 1. **App.tsx - TrustedPeersGatewaysProvider with arweave.net**

**Location**: `src/App.tsx:66-77`

```typescript
const peersEndpoints: string[] = ['https://arweave.net'];
// ...
for (const trustedGateway of peersEndpoints) {
  try {
    const provider = new TrustedPeersGatewaysProvider({ trustedGateway });
    const gateways = await provider.getGateways();
```

**Issue**: `TrustedPeersGatewaysProvider` from `@ar.io/wayfinder-core` expects an AR.IO gateway that supports `/ar-io/peers` endpoint. arweave.net does not have this endpoint.

**Impact**:
- Primary gateway fetching mechanism fails
- App falls back to secondary mechanisms which may also be broken

---

### 2. **trustedGateways.ts - Direct /ar-io/peers Call**

**Location**: `src/utils/trustedGateways.ts:142-144`

```typescript
export async function getRoutingGateways(): Promise<URL[]> {
  try {
    const response = await fetch('https://arweave.net/ar-io/peers');
```

**Issue**: Direct hardcoded call to arweave.net's /ar-io/peers endpoint

**Impact**:
- This function is used by the service worker for verification mode
- Returns 404, causing the function to throw and fall back to emergency gateways
- Breaks verification flow when enabled

---

### 3. **Ultimate Fallback to arweave.net**

**Location**: Multiple locations use arweave.net as "safe" fallback

- `src/App.tsx:93`: `return [new URL('https://arweave.net')];`
- `src/App.tsx:139`: `preferredGateway = 'https://arweave.net'`
- `src/utils/trustedGateways.ts:70`: `return [{ url: 'https://arweave.net', totalStake: 0 }];`
- `src/utils/trustedGateways.ts:92`: `return freshCached || [{ url: 'https://arweave.net', totalStake: 0 }];`
- `src/service-worker/wayfinder-instance.ts:130`: `const preferredGateway = config.preferredGateway.trim() || 'https://arweave.net';`
- `src/service-worker/location-patcher.ts:31`: `gatewayHost = 'arweave.net';`
- `src/components/SettingsFlyout.tsx:167`: `placeholder="https://arweave.net"`

**Issue**: Using arweave.net as a fallback is reasonable for content fetching (it's still an Arweave gateway), but NOT for AR.IO API endpoints.

**Impact**:
- Fallbacks work for basic content fetching
- Fail for any AR.IO-specific functionality
- Confusing error messages when fallbacks trigger

---

## What Still Works

✅ **Content Fetching**: arweave.net still works for fetching Arweave content by transaction ID
✅ **Basic Gateway**: Can serve content via `/{txid}` paths
✅ **ArNS Resolution**: arweave.net still supports ArNS via subdomain format

## What's Broken

❌ **Gateway Discovery**: Cannot fetch peer list from arweave.net
❌ **Primary Gateway Provider**: TrustedPeersGatewaysProvider fails with arweave.net
❌ **Routing Gateway Fetching**: Service worker's getRoutingGateways() fails
❌ **Documentation**: CLAUDE.md incorrectly states arweave.net provides /ar-io/peers

## Root Cause Analysis

The architecture assumes that ANY Arweave gateway could also be an AR.IO gateway with additional APIs. This was true when arweave.net was part of the AR.IO network, but is no longer valid.

**Key architectural assumption that broke**:
> "arweave.net is a safe, reliable fallback gateway that supports all AR.IO APIs"

## Current Mitigation

The app has multiple fallback layers that partially mitigate the issue:

1. **Host Gateway Fallback** (App.tsx:68-72): If viewing the app from an AR.IO gateway, tries that gateway's /ar-io/peers
2. **Direct Host Gateway Use** (App.tsx:87-89): Uses the hosting gateway directly if API calls fail
3. **Emergency Fallback** (App.tsx:92-93): Uses arweave.net directly (not via API)

These fallbacks mean:
- ✅ App works when hosted on an AR.IO gateway (e.g., wayfinder.ar-io.dev)
- ⚠️  App may partially work in local development (content fetching works, gateway discovery fails)
- ❌ Service worker verification mode fails in some scenarios

## Recommended Fixes

### Immediate (Critical)

1. **Replace arweave.net in TrustedPeersGatewaysProvider**
   - Use a known AR.IO gateway as primary (e.g., `ar-io.dev`, `g8way.io`)
   - Keep arweave.net ONLY for direct content fallback, not API calls

2. **Fix getRoutingGateways()**
   - Use an AR.IO gateway instead of arweave.net
   - Add fallback to multiple AR.IO gateways

### Short-term (High Priority)

3. **Separate Gateway Types**
   - Create distinct types: `ContentGateway` vs `ARIOGateway`
   - Document which requires AR.IO APIs
   - Use appropriate gateways for each purpose

4. **Update Documentation**
   - CLAUDE.md needs corrections about arweave.net
   - Add warnings about gateway API assumptions

### Long-term (Architectural)

5. **Gateway Capability Detection**
   - Probe gateways for AR.IO API support
   - Fall back gracefully when APIs not available
   - Cache capability detection results

6. **Use AR.IO SDK for Gateway Discovery**
   - Leverage `@ar.io/sdk`'s `getGateways()` method instead of direct API calls
   - Already used for trusted gateways, extend to routing gateways

## Testing Commands

```bash
# Verify arweave.net lacks AR.IO APIs
curl -s "https://arweave.net/ar-io/peers"  # Should return 404

# Verify it still works for content
curl -s "https://arweave.net/KKmRbIfrc7wiLcG0zvY1etlO0NBx1926dSCksxCIN3A" | head -1  # Should return content

# Test a real AR.IO gateway (if available)
curl -s "https://ar-io.dev/ar-io/peers"  # Should return peer list JSON
curl -s "https://g8way.io/ar-io/peers"   # Should return peer list JSON
```

## Risk Assessment

**Severity**: 🔴 **HIGH**
**Likelihood**: 🔴 **ACTIVE** (issue is currently happening)

**User Impact**:
- Gateway discovery fails in some deployment scenarios
- Verification mode may not work correctly
- Slower content loading due to failed API attempts before fallback
- Confusing error messages

**Business Impact**:
- App works when hosted on AR.IO gateways (mitigates severity)
- Local development experience degraded
- Documentation misleading to developers

## Next Steps

1. ✅ Document the issue (this file)
2. ⬜ Create GitHub issue for tracking
3. ⬜ Implement immediate fixes (replace arweave.net in API calls)
4. ⬜ Add integration tests for gateway API availability
5. ⬜ Update CLAUDE.md and README.md

## References

- AR.IO Gateway Network Docs: https://docs.ar.io/build/gateways/gateway-network
- AR.IO SDK: https://www.npmjs.com/package/@ar.io/sdk
- AR.IO Node Changelog: https://github.com/ar-io/ar-io-node/blob/develop/CHANGELOG.md

---

**Analysis by**: Claude Code
**Status**: DRAFT - Awaiting review and remediation
