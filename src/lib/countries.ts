// Billing countries offered at sign-up (ISO 3166-1 alpha-2). Add more as needed.
export const COUNTRIES = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["GB", "United Kingdom"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
  ["IE", "Ireland"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["NL", "Netherlands"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["DK", "Denmark"],
  ["CH", "Switzerland"],
  ["MX", "Mexico"],
  ["BR", "Brazil"],
  ["IN", "India"],
  ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia"],
  ["SG", "Singapore"],
  ["JP", "Japan"],
] as const;

export const COUNTRY_CODES: ReadonlySet<string> = new Set(COUNTRIES.map(([code]) => code));
