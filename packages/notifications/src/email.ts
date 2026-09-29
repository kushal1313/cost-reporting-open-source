import nodemailer from "nodemailer";
import type { NotificationMessage, NotificationSender } from "./types.js";

export interface EmailConfig {
  to: string;
}

function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) throw new Error("SMTP_HOST env var is required to send email notifications");
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT ?? 587) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

export const emailSender: NotificationSender<EmailConfig> = {
  type: "email",

  async send(config, message: NotificationMessage) {
    const transport = buildTransport();
    const fieldsHtml = message.fields
      ? `<table>${Object.entries(message.fields)
          .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${v}</td></tr>`)
          .join("")}</table>`
      : "";

    await transport.sendMail({
      from: process.env.SMTP_FROM ?? "cost-reports@example.com",
      to: config.to,
      subject: message.title,
      text: message.body,
      html: `<p>${message.body}</p>${fieldsHtml}`,
    });
  },
};
