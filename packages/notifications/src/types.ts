export interface NotificationMessage {
  title: string;
  /** Plain-text/markdown body; each sender adapts formatting to its channel. */
  body: string;
  /** Optional structured facts rendered as a table where the channel supports it. */
  fields?: Record<string, string>;
}

export interface NotificationSender<TConfig = unknown> {
  readonly type: string;
  send(config: TConfig, message: NotificationMessage): Promise<void>;
}
