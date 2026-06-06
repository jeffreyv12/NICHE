// Phase 3.2 — per-network webhook secret resolution.
//
// The {token} path segment authenticates the postback; *_SIGNING_SECRET (where
// present) additionally HMAC-verifies the body. Read straight from process.env
// so an unconfigured network simply has no token and is rejected.

import type { AffiliateNetwork } from "@nichefinder/shared";

export interface NetworkWebhookConfig {
  /** Expected {token} path segment. undefined ⇒ network not configured. */
  token: string | undefined;
  /** HMAC signing secret, if this network signs its postbacks. */
  signingSecret: string | undefined;
}

export function getNetworkWebhookConfig(network: AffiliateNetwork): NetworkWebhookConfig {
  switch (network) {
    case "bol":
      return { token: process.env.WEBHOOK_BOL_TOKEN, signingSecret: undefined };
    case "awin":
      return {
        token: process.env.WEBHOOK_AWIN_TOKEN,
        signingSecret: process.env.WEBHOOK_AWIN_SIGNING_SECRET,
      };
    case "daisycon":
      return { token: process.env.WEBHOOK_DAISYCON_TOKEN, signingSecret: undefined };
    case "digistore24":
      return {
        token: process.env.WEBHOOK_DIGISTORE_TOKEN,
        signingSecret: process.env.DIGISTORE_IPN_PASSPHRASE,
      };
    case "impact":
      return {
        token: process.env.WEBHOOK_IMPACT_TOKEN,
        signingSecret: process.env.WEBHOOK_IMPACT_SIGNING_SECRET,
      };
    default:
      return { token: undefined, signingSecret: undefined };
  }
}
