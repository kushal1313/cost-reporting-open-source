/**
 * FOCUS ProviderName is the vendor ("Anthropic", "OpenAI"), but people know
 * these by product name.
 */
const DISPLAY_NAMES: Record<string, string> = {
  Anthropic: "Claude",
  OpenAI: "ChatGPT",
  GrafanaCloud: "Grafana Cloud",
};

export function providerDisplayName(provider: string): string {
  return DISPLAY_NAMES[provider] ?? provider;
}
