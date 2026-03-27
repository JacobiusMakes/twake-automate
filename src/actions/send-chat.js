/**
 * Send Chat Message Action — posts a message to a Matrix room.
 *
 * Action config:
 *   type: "chat:send"
 *   params:
 *     room: "!roomId:twake.app"
 *     message: "New file uploaded: {{event.name}}"
 */

export class SendChatAction {
  constructor(config) {
    this.homeserver = config.matrixHomeserver;
    this.token = config.matrixToken;
  }

  async execute(params) {
    const { room, message } = params;
    if (!room || !message) throw new Error("chat:send requires 'room' and 'message'");

    const txnId = `auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `${this.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${txnId}`;

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ msgtype: "m.text", body: message }),
    });

    if (!res.ok) throw new Error(`Failed to send chat message: ${res.status}`);
    return { sent: true, room, message };
  }
}
