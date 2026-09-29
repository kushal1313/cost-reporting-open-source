import type { NotificationMessage, NotificationSender } from "./types.js";

export interface GenericWebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

export const genericWebhookSender: NotificationSender<GenericWebhookConfig> = {
  type: "webhook",

  async send(config, message: NotificationMessage) {
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...config.headers },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      throw new Error(`Webhook notification failed: ${res.status} ${await res.text()}`);
    }
  },
};
