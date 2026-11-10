import { COUNTRY_CODES } from "./countries";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // Supabase (bcrypt) ignores anything longer

export type BillingAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type SignupInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  address: BillingAddress;
};

function text(value: unknown, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmail(email: string) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** Keeps a leading + and digits: "+1 (555) 123-4567" → "+15551234567". */
export function normalizePhone(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return (trimmed.startsWith("+") ? "+" : "") + digits;
}

/** Returns the cleaned input, or an error message for the first problem. */
export function parseSignup(body: Record<string, unknown>): SignupInput | { error: string } {
  const firstName = text(body.firstName, 50);
  const lastName = text(body.lastName, 50);
  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  const raw = (typeof body.address === "object" && body.address) || {};
  const a = raw as Record<string, unknown>;
  const address: BillingAddress = {
    line1: text(a.line1, 200),
    line2: text(a.line2, 200),
    city: text(a.city),
    state: text(a.state),
    postalCode: text(a.postalCode, 20),
    country: text(a.country, 2).toUpperCase(),
  };

  if (!firstName) return { error: "Please enter your first name." };
  if (!lastName) return { error: "Please enter your last name." };
  if (!/^\+?\d{10,15}$/.test(phone)) return { error: "Please enter a valid phone number." };
  if (!isValidEmail(email)) return { error: "Please enter a valid email address." };
  if (password.length < PASSWORD_MIN) {
    return { error: `Password must be at least ${PASSWORD_MIN} characters.` };
  }
  if (password.length > PASSWORD_MAX) {
    return { error: `Password must be at most ${PASSWORD_MAX} characters.` };
  }
  if (password !== confirmPassword) return { error: "Passwords don’t match." };
  if (!address.line1 || !address.city || !address.postalCode) {
    return { error: "Please enter your full billing address." };
  }
  if (!COUNTRY_CODES.has(address.country)) return { error: "Please choose your country." };
  if (body.acceptTerms !== true) return { error: "Please accept the terms and conditions." };

  return { firstName, lastName, phone, email, password, address };
}
