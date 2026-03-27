/**
 * File Upload Trigger — fires when a new file appears in Twake Drive.
 *
 * Polls a Cozy folder for changes and detects new files.
 *
 * Trigger config:
 *   type: "drive:upload"
 *   filter:
 *     folder: "io.cozy.files.root-dir"  (optional — watch specific folder)
 *     name: "/\\.pdf$/"                  (optional — regex on filename)
 */

export class FileUploadTrigger {
  constructor(config) {
    this.cozyUrl = config.cozyUrl;
    this.cozyToken = config.cozyToken;
    this.pollInterval = config.pollInterval || 30000;
    this.knownIds = new Set();
    this.running = false;
  }

  async start(triggerConfigs, emit) {
    this.running = true;

    // Determine which folder(s) to watch
    const folders = new Set(["io.cozy.files.root-dir"]);
    for (const cfg of triggerConfigs) {
      if (cfg.filter?.folder) folders.add(cfg.filter.folder);
    }

    // Seed known files
    for (const folderId of folders) {
      const files = await this.listFolder(folderId);
      for (const f of files) this.knownIds.add(f.id);
    }

    console.log(`  [trigger] drive:upload — watching ${folders.size} folder(s) (${this.knownIds.size} existing files)`);

    while (this.running) {
      await new Promise((r) => setTimeout(r, this.pollInterval));
      if (!this.running) break;

      try {
        for (const folderId of folders) {
          const files = await this.listFolder(folderId);
          for (const file of files) {
            if (!this.knownIds.has(file.id)) {
              this.knownIds.add(file.id);
              emit({
                id: file.id,
                name: file.name,
                type: file.type,
                size: file.size,
                folder: folderId,
                createdAt: file.createdAt,
              });
            }
          }
        }
      } catch (err) {
        console.error(`  [trigger] drive:upload poll error: ${err.message}`);
      }
    }
  }

  stop() {
    this.running = false;
  }

  async listFolder(folderId) {
    const res = await fetch(`${this.cozyUrl}/files/${folderId}`, {
      headers: {
        Authorization: `Bearer ${this.cozyToken}`,
        Accept: "application/vnd.api+json",
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.included || []).map((item) => ({
      id: item.id,
      name: item.attributes?.name || item.id,
      type: item.attributes?.type || "file",
      size: item.attributes?.size || 0,
      createdAt: item.attributes?.created_at,
    }));
  }
}
