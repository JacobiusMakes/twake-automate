/**
 * Schedule Trigger — fires on a cron-like schedule.
 *
 * Trigger config:
 *   type: "schedule"
 *   params:
 *     cron: "0 9 * * 1-5"  — weekdays at 9am
 *     cron: "*/5 * * * *"  — every 5 minutes
 */

export class ScheduleTrigger {
  constructor() {
    this.timers = [];
    this.running = false;
  }

  start(triggerConfigs, emit) {
    this.running = true;

    for (const cfg of triggerConfigs) {
      const cron = cfg.params?.cron;
      if (!cron) continue;

      const interval = this.cronToMs(cron);
      if (!interval) {
        console.error(`  [trigger] schedule — invalid cron: ${cron}`);
        continue;
      }

      console.log(`  [trigger] schedule — "${cron}" (every ${interval / 1000}s)`);

      const timer = setInterval(() => {
        if (!this.running) return;
        const now = new Date();
        if (this.cronMatches(cron, now)) {
          emit({
            timestamp: now.toISOString(),
            cron,
          });
        }
      }, interval);

      this.timers.push(timer);
    }
  }

  stop() {
    this.running = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /**
   * Simple cron interval parser.
   * Supports: *\/N for every N units, exact values.
   * Full cron parsing would use a library — this handles common cases.
   */
  cronToMs(cron) {
    const parts = cron.split(" ");
    if (parts.length !== 5) return null;

    const [min] = parts;

    // */N minutes
    const everyMatch = min.match(/^\*\/(\d+)$/);
    if (everyMatch) return parseInt(everyMatch[1]) * 60 * 1000;

    // Fixed time — check every minute
    return 60 * 1000;
  }

  cronMatches(cron, date) {
    const parts = cron.split(" ");
    const [minSpec, hourSpec, , , dowSpec] = parts;

    const min = date.getMinutes();
    const hour = date.getHours();
    const dow = date.getDay(); // 0=Sun

    if (!this.fieldMatches(minSpec, min)) return false;
    if (!this.fieldMatches(hourSpec, hour)) return false;
    if (!this.fieldMatches(dowSpec, dow)) return false;

    return true;
  }

  fieldMatches(spec, value) {
    if (spec === "*") return true;

    // */N
    const everyMatch = spec.match(/^\*\/(\d+)$/);
    if (everyMatch) return value % parseInt(everyMatch[1]) === 0;

    // Range: 1-5
    const rangeMatch = spec.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) return value >= parseInt(rangeMatch[1]) && value <= parseInt(rangeMatch[2]);

    // Exact value
    return parseInt(spec) === value;
  }
}
