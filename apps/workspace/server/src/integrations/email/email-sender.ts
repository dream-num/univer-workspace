import nodemailer from "nodemailer";
import { logger } from "../../logging/logger.js";

export interface EmailAddress {
  readonly address: string;
  readonly name?: string;
}

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface SmtpEmailConfig {
  readonly provider: "smtp";
  readonly from: EmailAddress;
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly username?: string;
    readonly password?: string;
  };
}

/**
 * Writes the message to the server log instead of sending it. Intended for local
 * development, where an operator can read the sign-in code from the log.
 */
export interface ConsoleEmailConfig {
  readonly provider: "console";
  readonly from: EmailAddress;
}

export type EmailConfig = SmtpEmailConfig | ConsoleEmailConfig;

export function createEmailSender(config: EmailConfig): EmailSender {
  return config.provider === "console"
    ? createConsoleEmailSender(config)
    : createSmtpEmailSender(config);
}

export function formatEmailAddress(address: EmailAddress): string {
  return address.name === undefined
    ? address.address
    : `${address.name} <${address.address}>`;
}

function createSmtpEmailSender(config: SmtpEmailConfig): EmailSender {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.username === undefined
      ? {}
      : {
          auth: {
            user: config.smtp.username,
            pass: config.smtp.password ?? "",
          },
        }),
  });
  return {
    async send(message) {
      await transport.sendMail({
        from: formatEmailAddress(config.from),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

function createConsoleEmailSender(config: ConsoleEmailConfig): EmailSender {
  return {
    async send(message) {
      logger.info(
        {
          from: formatEmailAddress(config.from),
          to: message.to,
          subject: message.subject,
          body: message.text,
        },
        "email delivered through the console provider"
      );
    },
  };
}
