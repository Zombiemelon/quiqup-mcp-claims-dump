/**
 * Derive the Clerk issuer URL from CLERK_ISSUER_URL or by decoding the
 * publishable key (`pk_(test|live)_<base64-encoded-domain>`).
 */
export function getClerkIssuerUrl(): string {
  if (process.env.CLERK_ISSUER_URL) return process.env.CLERK_ISSUER_URL;

  const pk = process.env.CLERK_PUBLISHABLE_KEY;
  if (!pk) throw new Error("CLERK_ISSUER_URL or CLERK_PUBLISHABLE_KEY must be set");

  const match = pk.match(/^pk_(test|live)_(.+)$/);
  if (!match) throw new Error("Invalid Clerk publishable key format");

  const decoded = Buffer.from(
    match[2] + "=".repeat((4 - (match[2].length % 4)) % 4),
    "base64",
  ).toString("utf-8");
  return `https://${decoded.replace(/\$$/, "")}`;
}
