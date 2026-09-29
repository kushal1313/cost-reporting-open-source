import { emailSender } from "./email.js";
import { slackWebhookSender } from "./slack.js";
import type { NotificationSender } from "./types.js";
import { genericWebhookSender } from "./webhook.js";

export type { NotificationMessage, NotificationSender } from "./types.js";
export type { SlackWebhookConfig } from "./slack.js";
export type { EmailConfig } from "./email.js";
export type { GenericWebhookConfig } from "./webhook.js";

const senders: Record<string, NotificationSender<any>> = {
  [slackWebhookSender.type]: slackWebhookSender,
  [emailSender.type]: emailSender,
  [genericWebhookSender.type]: genericWebhookSender,
};

export function getNotificationSender(type: string): NotificationSender<any> {
  const sender = senders[type];
  if (!sender) {
    throw new Error(
      `No notification sender for type "${type}". Known types: ${Object.keys(senders).join(", ")}`,
    );
  }
  return sender;
}
