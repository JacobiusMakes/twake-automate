/**
 * Workflow Engine — The core runtime that evaluates triggers and executes actions.
 *
 * A workflow is a declarative rule:
 *   WHEN [trigger] → IF [condition] → THEN [action(s)]
 *
 * Workflows are defined in YAML/JSON and loaded at startup.
 * The engine listens for events from all Twake services and
 * evaluates them against registered workflows.
 *
 * Architecture:
 *   [Event Sources] → [Engine] → [Condition Evaluator] → [Action Executor]
 *       Matrix            ↕              ↕                      ↕
 *       JMAP          Workflow DB    Template Engine        API Clients
 *       Cozy                                               LUCIE AI
 *       Cron
 */

import { EventEmitter } from "node:events";

export class WorkflowEngine extends EventEmitter {
  constructor() {
    super();
    this.workflows = [];
    this.triggers = new Map();   // triggerType → handler
    this.actions = new Map();    // actionType → handler
    this.running = false;
    this.stats = { processed: 0, matched: 0, executed: 0, errors: 0 };
  }

  /**
   * Register a trigger type.
   * Triggers produce events when something happens in the Twake ecosystem.
   */
  registerTrigger(type, handler) {
    this.triggers.set(type, handler);
    return this;
  }

  /**
   * Register an action type.
   * Actions are executed when a workflow's conditions are met.
   */
  registerAction(type, handler) {
    this.actions.set(type, handler);
    return this;
  }

  /**
   * Load workflow definitions.
   * Each workflow has: id, name, trigger, conditions (optional), actions.
   */
  loadWorkflows(workflows) {
    for (const wf of workflows) {
      this.validateWorkflow(wf);
      this.workflows.push(wf);
    }
    this.emit("workflows:loaded", this.workflows.length);
    return this;
  }

  validateWorkflow(wf) {
    if (!wf.id) throw new Error("Workflow missing 'id'");
    if (!wf.trigger?.type) throw new Error(`Workflow ${wf.id} missing 'trigger.type'`);
    if (!wf.actions?.length) throw new Error(`Workflow ${wf.id} missing 'actions'`);
    if (!this.triggers.has(wf.trigger.type)) {
      throw new Error(`Workflow ${wf.id}: unknown trigger type '${wf.trigger.type}'`);
    }
    for (const action of wf.actions) {
      if (!this.actions.has(action.type)) {
        throw new Error(`Workflow ${wf.id}: unknown action type '${action.type}'`);
      }
    }
  }

  /**
   * Process an incoming event against all workflows.
   * Called by trigger handlers when they detect an event.
   */
  async processEvent(eventType, eventData) {
    this.stats.processed++;

    for (const wf of this.workflows) {
      if (!wf.enabled !== false && wf.trigger.type !== eventType) continue;

      // Check trigger-level filters
      if (!this.matchesTriggerFilter(wf.trigger, eventData)) continue;

      // Evaluate conditions
      if (wf.conditions && !this.evaluateConditions(wf.conditions, eventData)) continue;

      this.stats.matched++;
      this.emit("workflow:triggered", { workflow: wf.id, event: eventType });

      // Execute actions sequentially
      const context = { event: eventData, workflow: wf, results: {} };

      for (const action of wf.actions) {
        try {
          const handler = this.actions.get(action.type);
          const resolvedParams = this.resolveTemplates(action.params || {}, context);
          const result = await handler(resolvedParams, context);
          context.results[action.id || action.type] = result;
          this.stats.executed++;
          this.emit("action:executed", { workflow: wf.id, action: action.type });
        } catch (err) {
          this.stats.errors++;
          this.emit("action:error", { workflow: wf.id, action: action.type, error: err.message });
          if (action.stopOnError !== false) break;
        }
      }
    }
  }

  /**
   * Check if event data matches the trigger's filter criteria.
   */
  matchesTriggerFilter(trigger, data) {
    if (!trigger.filter) return true;

    for (const [key, expected] of Object.entries(trigger.filter)) {
      const actual = this.getNestedValue(data, key);
      if (typeof expected === "string" && expected.startsWith("/") && expected.endsWith("/")) {
        // Regex filter
        const regex = new RegExp(expected.slice(1, -1), "i");
        if (!regex.test(String(actual))) return false;
      } else if (actual !== expected) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate conditions (AND logic by default).
   */
  evaluateConditions(conditions, data) {
    for (const cond of conditions) {
      const value = this.getNestedValue(data, cond.field);
      switch (cond.operator) {
        case "equals": if (value !== cond.value) return false; break;
        case "not_equals": if (value === cond.value) return false; break;
        case "contains": if (!String(value).includes(cond.value)) return false; break;
        case "not_contains": if (String(value).includes(cond.value)) return false; break;
        case "matches": if (!new RegExp(cond.value, "i").test(String(value))) return false; break;
        case "exists": if (value === undefined || value === null) return false; break;
        case "gt": if (Number(value) <= Number(cond.value)) return false; break;
        case "lt": if (Number(value) >= Number(cond.value)) return false; break;
        default: return false;
      }
    }
    return true;
  }

  /**
   * Resolve template strings in action parameters.
   * Templates use {{event.field}} syntax to reference event data.
   */
  resolveTemplates(params, context) {
    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") {
        resolved[key] = value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
          return String(this.getNestedValue(context, path) ?? "");
        });
      } else if (typeof value === "object" && value !== null) {
        resolved[key] = this.resolveTemplates(value, context);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  getNestedValue(obj, path) {
    return path.split(".").reduce((o, k) => o?.[k], obj);
  }

  /**
   * Start all registered triggers.
   */
  async start() {
    this.running = true;
    this.emit("engine:start");

    for (const [type, handler] of this.triggers) {
      // Each trigger calls processEvent when it detects something
      const triggerConfigs = this.workflows
        .filter(wf => wf.trigger.type === type)
        .map(wf => wf.trigger);

      if (triggerConfigs.length > 0) {
        handler.start(triggerConfigs, (eventData) => this.processEvent(type, eventData));
      }
    }
  }

  async stop() {
    this.running = false;
    for (const [, handler] of this.triggers) {
      if (handler.stop) await handler.stop();
    }
    this.emit("engine:stop", this.stats);
  }
}
