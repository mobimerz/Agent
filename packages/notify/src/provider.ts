import type { BrevoEmail } from "./brevo";

/**
 * Pluggable email transport. Brevo today; an SMTP (Nodemailer) provider can be
 * added later by implementing this interface and returning it from createNotifyContext.
 */
export interface EmailProvider {
  readonly name: string;
  send(email: BrevoEmail): Promise<{ messageId: string }>;
}
