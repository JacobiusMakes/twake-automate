/**
 * New Email Trigger — fires when a new email arrives in the JMAP inbox.
 *
 * Polls the JMAP inbox periodically and detects new email IDs.
 *
 * Trigger config:
 *   type: "mail:new"
 *   filter:
 *     from: "/.*@client.com/"   (optional — regex on sender)
 *     subject: "/invoice/i"     (optional — regex on subject)
 */

import { createHash } from "crypto";

export class NewEmailTrigger {
  constructor(config) {
    this.jmapUrl = config.jmapUrl;
    this.jmapToken = config.jmapToken;
    this.pollInterval = config.pollInterval || 30000;
    this.knownIds = new Set();
    this.running = false;
  }

  async start(triggerConfigs, emit) {
    this.running = true;

    // Get inbox ID
    const inboxId = await this.getInboxId();
    if (!inboxId) {
      console.error("  [trigger] mail:new — could not find inbox");
      return;
    }

    // Seed known IDs
    const initialIds = await this.getEmailIds(inboxId);
    for (const id of initialIds) this.knownIds.add(id);

    console.log(`  [trigger] mail:new — watching inbox (${this.knownIds.size} existing, poll every ${this.pollInterval / 1000}s)`);

    while (this.running) {
      await new Promise((r) => setTimeout(r, this.pollInterval));
      if (!this.running) break;

      try {
        const currentIds = await this.getEmailIds(inboxId);
        const newIds = currentIds.filter((id) => !this.knownIds.has(id));

        if (newIds.length > 0) {
          // Fetch full email data for new emails
          const emails = await this.getEmails(newIds);
          for (const email of emails) {
            this.knownIds.add(email.id);
            emit({
              id: email.id,
              from: email.from?.[0]?.email || "unknown",
              fromName: email.from?.[0]?.name || "",
              to: email.to?.map((a) => a.email) || [],
              subject: email.subject || "",
              preview: email.preview || "",
              receivedAt: email.receivedAt,
            });
          }
        }
      } catch (err) {
        console.error(`  [trigger] mail:new poll error: ${err.message}`);
      }
    }
  }

  stop() {
    this.running = false;
  }

  get accountId() {
    const payload = JSON.parse(Buffer.from(this.jmapToken.split(".")[1], "base64").toString());
    return createHash("sha256").update(payload.email || payload.sub).digest("hex");
  }

  async jmapCall(methodCalls) {
    const calls = methodCalls.map(([m, a, id]) => [m, { accountId: this.accountId, ...a }, id]);
    const res = await fetch(this.jmapUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.jmapToken}`,
        "Content-Type": "application/json",
        Accept: "application/json;jmapVersion=rfc-8621",
      },
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        methodCalls: calls,
      }),
    });
    if (!res.ok) throw new Error(`JMAP ${res.status}`);
    return (await res.json()).methodResponses;
  }

  async getInboxId() {
    const res = await this.jmapCall([["Mailbox/get", { properties: ["id", "role"] }, "0"]]);
    return res.find((r) => r[2] === "0")?.[1]?.list?.find((b) => b.role === "inbox")?.id;
  }

  async getEmailIds(inboxId) {
    const res = await this.jmapCall([
      ["Email/query", { filter: { inMailbox: inboxId }, sort: [{ property: "receivedAt", isAscending: false }], limit: 50 }, "0"],
    ]);
    return res.find((r) => r[2] === "0")?.[1]?.ids || [];
  }

  async getEmails(ids) {
    const res = await this.jmapCall([
      ["Email/get", { ids, properties: ["id", "from", "to", "subject", "receivedAt", "preview"] }, "0"],
    ]);
    return res.find((r) => r[2] === "0")?.[1]?.list || [];
  }
}
