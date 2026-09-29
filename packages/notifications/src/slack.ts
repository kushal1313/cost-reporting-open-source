import type { NotificationMessage, NotificationSender } from "./types.js";

export interface SlackWebhookConfig {
  webhookUrl: string;
}

export const slackWebhookSender: NotificationSender<SlackWebhookConfig> = {
  type: "slack",

  async send(config, message: NotificationMessage) {
    const fieldsText = message.fields
      ? Object.entries(message.fields)
          .map(([k, v]) => `*${k}:* ${v}`)
          .join("\n")
      : undefined;

    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: [
          { type: "header", text: { type: "plain_text", text: message.title } },
          { type: "section", text: { type: "mrkdwn", text: message.body } },
          ...(fieldsText ? [{ type: "section", text: { type: "mrkdwn", text: fieldsText } }] : []),
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
    }
  },
};
