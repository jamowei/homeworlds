// Optional TURN relay configuration for the shared board.
//
// Without this, the app uses public STUN servers only. STUN gets two peers
// connected directly for most home networks, but it cannot traverse a
// *symmetric* NAT; a TURN relay can, at the cost of relaying the traffic.
//
// To enable Metered's TURN service:
//   1. Create a credential in the Metered dashboard (dashboard.metered.ca).
//   2. On that credential, click "Get credential" → "Show API Key" and copy the
//      key. This key only unlocks this one credential, so it is safe to ship in
//      front-end code.
//   3. Copy your Metered domain (Developers page), e.g. "yourappname.metered.live".
//   4. Fill both fields in below.
//
// The username/password themselves are fetched at runtime from Metered and are
// never stored here. Leave both fields empty to stay STUN-only.

export const TURN_CONFIG = {
  domain: 'homeworlds.metered.live', // e.g. 'yourappname.metered.live'
  apiKey: '347fc0bfb42cf39408a4834895ff9542e5e1', // the credential-scoped API key
};
