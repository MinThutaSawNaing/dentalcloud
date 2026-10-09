# Assistant progressive startup

## Bottleneck and change

Previously, lean staff navigation withheld the Assistant component until all nine
complete clinic datasets resolved. Only then could React.lazy begin downloading
the Assistant module: data and module loading were on a sequential critical path.

Entering the permitted Assistant tab now starts its module download alongside
the existing data loader. After branch startup finishes, the workspace can mount
while those historical reads remain in flight. Users can view saved chats, open
help, and draft messages. A status explains why sending is unavailable.

All message entry paths use the same readiness guard, including keyboard,
suggestions, voice submissions, and pending-action confirmations. Sending remains
disabled until the complete bundle is published. Failed reads show an explicit
Retry without discarding a typed draft. No partial financial bundle is published.

The existing session-memory cache, permission/branch/session guards, full-history
queries, and atomic data publication remain unchanged. Unready props mask old
clinic datasets; the workspace key isolates branch/startup replacements. This
does not reduce the nine dataset reads or implement offline access. The legacy
non-lean startup path retains its existing readiness behavior.

## Verification and limitations

- Runtime tests execute the real App data-loader effect with deferred API reads
  and verify module loading begins before data completion.
- Existing navigation tests verify cache reuse, failure/retry, and stale results
  after branch/session/permission changes.
- Source integration guards cover early rendering, masked props, and send guards.
- Server-rendered status tests cover loading, escaped errors, and readiness.

These tests are not an authenticated browser timing measurement. No production
speedup in seconds is claimed, and no deployment is performed by this change.
The structural baseline is data latency plus module latency; parallel scheduling
removes that enforced sum, subject to shared bandwidth and browser processing.

Before deployment, verify in preview with synthetic clinic data and throttled
network: open Assistant, draft during loading, verify sending waits, retry a
failed read, navigate away/back, and switch branches without stale responses.