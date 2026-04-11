// ---------------------------------------------------------------------------
// googleOauth — Google OAuth 2.0 + OpenID Connect service
//
// Barrel index. Import via the shim at the parent level:
//
//   import * as googleOauth from "@shared/rest/services/auth/google-oauth";
//
//   const url = googleOauth.buildAuthorizationUrl(input);
//   const tokens = await googleOauth.exchangeCode(input);
//   const profile = await googleOauth.verifyIdToken(idToken, nonce);
//   const { user, created } = await googleOauth.findOrCreateUserFromProfile(tx, profile);
//
// Flow (caller perspective):
//
//   /api/auth/google/start
//     └── googleOauth.buildAuthorizationUrl({ state, nonce, codeChallenge, redirectUri })
//         → redirect user to Google
//
//   /api/auth/google/callback?code=...&state=...
//     ├── googleOauth.exchangeCode({ code, codeVerifier, redirectUri })
//     │       → Google's token endpoint, returns id_token + access_token
//     ├── googleOauth.verifyIdToken(idToken, expectedNonce)
//     │       → validates signature, issuer, audience, nonce, expiry
//     │       → returns a typed GoogleProfile
//     └── googleOauth.findOrCreateUserFromProfile(tx, profile)
//             → atomic find-or-create of User + AuthIdentity inside the tx
//
// File layout (split from a single 417-line file during Stage E of the
// service-layer rollout — see docs/service-layer-conventions.md):
//
//   authorize.ts  — URL construction (pure)
//   token.ts      — token endpoint exchange
//   verify.ts     — id_token verification + JWKS cache (security-critical)
//   identity.ts   — User + AuthIdentity transactional upsert
// ---------------------------------------------------------------------------

export * from "./authorize";
export * from "./token";
export * from "./verify";
export * from "./identity";
