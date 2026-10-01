// The only place with brand-specific values. No logo, colors or legal pages exist in the repository,
// so nothing is invented: a wordmark, and optional assets/links that can be supplied later via environment.
export const BRAND = {
  name: "Alltäglich leichter",
  instagramUsername: (process.env.META_INSTAGRAM_USERNAME || "alltaeglich.leichter").replace(/[^A-Za-z0-9._]/g, ""),
  logoUrl: /^https:\/\//.test(process.env.LANDING_LOGO_URL || "") ? process.env.LANDING_LOGO_URL! : null,
  imprintUrl: /^https:\/\//.test(process.env.LANDING_IMPRINT_URL || "") ? process.env.LANDING_IMPRINT_URL! : null,
  privacyUrl: /^https:\/\//.test(process.env.LANDING_PRIVACY_URL || "") ? process.env.LANDING_PRIVACY_URL! : null,
};
