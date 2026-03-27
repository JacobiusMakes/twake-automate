/**
 * Upload to Drive Action — saves content as a file in Twake Drive.
 *
 * Action config:
 *   type: "drive:upload"
 *   params:
 *     name: "email-{{event.from}}-{{event.subject}}.txt"
 *     content: "From: {{event.from}}\nSubject: {{event.subject}}\n\n{{event.preview}}"
 *     folder: "io.cozy.files.root-dir"
 */

export class UploadDriveAction {
  constructor(config) {
    this.cozyUrl = config.cozyUrl;
    this.cozyToken = config.cozyToken;
  }

  async execute(params) {
    const { name, content, folder = "io.cozy.files.root-dir" } = params;
    if (!name || !content) throw new Error("drive:upload requires 'name' and 'content'");

    const url = `${this.cozyUrl}/files/${folder}?Type=file&Name=${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cozyToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: content,
    });

    if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
    const data = await res.json();
    return { uploaded: true, name, id: data.data?.id };
  }
}
