/**
 * Chat Message Trigger — fires when a message is posted in a Matrix room.
 *
 * Uses Matrix /sync long-polling to watch for new messages in real-time.
 * Supports filtering by room, sender, and message content.
 *
 * Trigger config:
 *   type: "chat:message"
 *   filter:
 *     room: "!roomId:twake.app"  (optional — specific room)
 *     sender: "@user:twake.app"  (optional — specific sender)
 *     content: "/deploy/"        (optional — regex match on body)
 */

export class ChatMessageTrigger {
  constructor(config) {
    this.homeserver = config.matrixHomeserver;
    this.token = config.matrixToken;
    this.userId = config.matrixUserId || null;
    this.ignoreSelf = config.ignoreSelf !== false; // Default: ignore own messages
    this.since = null;
    this.running = false;
  }

  async start(triggerConfigs, emit) {
    this.running = true;

    // Discover our own user ID so we can ignore our own messages (prevent feedback loops)
    if (!this.userId) {
      try {
        const whoami = await this.matrixFetch('/account/whoami');
        this.userId = whoami.user_id;
      } catch { /* non-fatal */ }
    }

    // Initial sync to get a since token (don't emit old messages)
    const initRes = await this.matrixFetch(`/sync?timeout=0&filter={"room":{"timeline":{"limit":0}}}`);
    this.since = initRes.next_batch;

    console.log("  [trigger] chat:message — listening for messages");

    // Long-poll loop
    while (this.running) {
      try {
        const sync = await this.matrixFetch(
          `/sync?since=${this.since}&timeout=30000&filter={"room":{"timeline":{"limit":50}}}`
        );
        this.since = sync.next_batch;

        // Process new messages from all rooms
        const joinedRooms = sync.rooms?.join || {};
        for (const [roomId, roomData] of Object.entries(joinedRooms)) {
          for (const event of roomData.timeline?.events || []) {
            if (event.type === "m.room.message" && event.content?.body
                && !(this.ignoreSelf && event.sender === this.userId)
                && !event.content.body.startsWith('\u{1F916}')) {
              // Skip own messages (unless ignoreSelf=false) and skip bot-prefixed messages to prevent loops
              emit({
                room: roomId,
                sender: event.sender,
                body: event.content.body,
                msgtype: event.content.msgtype,
                timestamp: event.origin_server_ts,
                eventId: event.event_id,
              });
            }
          }
        }
      } catch (err) {
        console.error(`  [trigger] chat:message sync error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  stop() {
    this.running = false;
  }

  async matrixFetch(endpoint) {
    const res = await fetch(`${this.homeserver}/_matrix/client/v3${endpoint}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`Matrix ${res.status}`);
    return res.json();
  }
}
