/**
 * Webhook Action — sends an HTTP POST to an external URL.
 *
 * Enables integration with any external service: CI/CD, monitoring,
 * Slack, custom APIs, etc.
 *
 * Action config:
 *   type: "webhook"
 *   params:
 *     url: "https://api.example.com/notify"
 *     method: "POST" (default)
 *     headers: { "X-Custom": "value" }
 *     body: { "text": "{{event.subject}}" }
 */

export class WebhookAction {
  async execute(params) {
    const { url, method = "POST", headers = {}, body } = params;
    if (!url) throw new Error("webhook requires 'url'");

    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    return { status: res.status, ok: res.ok, url };
  }
}
