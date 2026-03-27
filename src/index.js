#!/usr/bin/env node

/**
 * twake-automate — Automation engine for Twake Workplace
 *
 * The missing piece in Linagora's collaboration suite. Every major platform
 * has automation (Slack Workflow Builder, Microsoft Power Automate, Google
 * Apps Script). Twake has nothing — until now.
 *
 * Watches for events across Chat (Matrix), Mail (JMAP), and Drive (Cozy),
 * evaluates rules, and executes actions including AI-powered classification
 * via LUCIE (Linagora's open-source LLM).
 *
 * Usage:
 *   twake-automate                         # Run with default workflows.json
 *   twake-automate --config my-rules.json  # Custom workflow file
 *
 * Environment variables:
 *   MATRIX_HOMESERVER, MATRIX_TOKEN
 *   JMAP_URL, JMAP_TOKEN
 *   COZY_URL, COZY_TOKEN
 *   HF_TOKEN (for LUCIE via Hugging Face)
 *   OLLAMA_URL (for local LLM)
 */

import { readFileSync, existsSync } from "node:fs";
import { WorkflowEngine } from "./engine/workflow.js";
import { ChatMessageTrigger } from "./triggers/chat-message.js";
import { NewEmailTrigger } from "./triggers/new-email.js";
import { FileUploadTrigger } from "./triggers/file-upload.js";
import { ScheduleTrigger } from "./triggers/schedule.js";
import { SendChatAction } from "./actions/send-chat.js";
import { WebhookAction } from "./actions/webhook.js";
import { UploadDriveAction } from "./actions/upload-drive.js";
import { AIClassifyAction, AIRouteAction } from "./actions/ai-classify.js";

// ============================================================
//  Configuration
// ============================================================

const config = {
  matrixHomeserver: process.env.MATRIX_HOMESERVER || "https://matrix.twake.app",
  matrixToken: process.env.MATRIX_TOKEN,
  jmapUrl: process.env.JMAP_URL || "https://jmap.twake.app/jmap",
  jmapToken: process.env.JMAP_TOKEN,
  cozyUrl: process.env.COZY_URL,
  cozyToken: process.env.COZY_TOKEN,
  hfToken: process.env.HF_TOKEN,
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  openaiUrl: process.env.OPENAI_URL,
  openaiKey: process.env.OPENAI_KEY,
  pollInterval: parseInt(process.env.POLL_INTERVAL || "30") * 1000,
};

// ============================================================
//  Load Workflows
// ============================================================

const configFile = process.argv.includes("--config")
  ? process.argv[process.argv.indexOf("--config") + 1]
  : "workflows.json";

let workflows;
if (existsSync(configFile)) {
  workflows = JSON.parse(readFileSync(configFile, "utf-8"));
} else {
  // Default example workflows
  workflows = [
    {
      id: "email-to-chat",
      name: "Notify chat when new email arrives",
      enabled: true,
      trigger: { type: "mail:new" },
      actions: [
        {
          type: "chat:send",
          params: {
            room: process.env.NOTIFY_ROOM || "",
            message: "📧 New email from {{event.fromName}} ({{event.from}}): {{event.subject}}",
          },
        },
      ],
    },
    {
      id: "file-upload-notify",
      name: "Notify chat when file uploaded to Drive",
      enabled: true,
      trigger: { type: "drive:upload" },
      actions: [
        {
          type: "chat:send",
          params: {
            room: process.env.NOTIFY_ROOM || "",
            message: "📁 New file in Drive: {{event.name}} ({{event.size}} bytes)",
          },
        },
      ],
    },
    {
      id: "ai-email-router",
      name: "AI-powered email routing to topic rooms",
      enabled: !!config.hfToken,
      trigger: { type: "mail:new" },
      actions: [
        {
          type: "ai:route",
          id: "classify",
          params: {
            content: "{{event.subject}}: {{event.preview}}",
            model: "lucie",
            routes: {
              finance: process.env.ROOM_FINANCE || "",
              engineering: process.env.ROOM_ENGINEERING || "",
              sales: process.env.ROOM_SALES || "",
              support: process.env.ROOM_SUPPORT || "",
            },
            default: process.env.NOTIFY_ROOM || "",
          },
        },
        {
          type: "chat:send",
          params: {
            room: "{{results.classify.destination}}",
            message: "📧 [{{results.classify.category}}] {{event.from}}: {{event.subject}}",
          },
        },
      ],
    },
  ];
}

// ============================================================
//  Initialize Engine
// ============================================================

const engine = new WorkflowEngine();

// Register triggers
if (config.matrixToken) {
  engine.registerTrigger("chat:message", new ChatMessageTrigger(config));
}
if (config.jmapToken) {
  engine.registerTrigger("mail:new", new NewEmailTrigger(config));
}
if (config.cozyToken) {
  engine.registerTrigger("drive:upload", new FileUploadTrigger(config));
}
engine.registerTrigger("schedule", new ScheduleTrigger());

// Register actions
if (config.matrixToken) {
  const chatAction = new SendChatAction(config);
  engine.registerAction("chat:send", (params) => chatAction.execute(params));
}
engine.registerAction("webhook", (params) => new WebhookAction().execute(params));
if (config.cozyToken) {
  const driveAction = new UploadDriveAction(config);
  engine.registerAction("drive:upload", (params) => driveAction.execute(params));
}

const aiAction = new AIClassifyAction(config);
engine.registerAction("ai:classify", (params) => aiAction.execute(params));
engine.registerAction("ai:summarize", (params) => aiAction.execute({ ...params, outputField: "summary" }));
const routeAction = new AIRouteAction(config);
engine.registerAction("ai:route", (params) => routeAction.execute(params));

// ============================================================
//  Event Logging
// ============================================================

engine.on("workflows:loaded", (count) => console.log(`Loaded ${count} workflow(s)`));
engine.on("engine:start", () => console.log("Engine started\n"));
engine.on("workflow:triggered", ({ workflow, event }) =>
  console.log(`  ⚡ ${workflow} triggered by ${event}`)
);
engine.on("action:executed", ({ workflow, action }) =>
  console.log(`  ✓ ${workflow} → ${action}`)
);
engine.on("action:error", ({ workflow, action, error }) =>
  console.error(`  ✗ ${workflow} → ${action}: ${error}`)
);
engine.on("engine:stop", (stats) =>
  console.log(`\nEngine stopped. Stats: ${JSON.stringify(stats)}`)
);

// ============================================================
//  Start
// ============================================================

console.log("╔══════════════════════════════════════════╗");
console.log("║     twake-automate — Workflow Engine     ║");
console.log("╚══════════════════════════════════════════╝\n");

console.log("Services:");
console.log(`  Chat:  ${config.matrixToken ? "✓" : "✗"} Matrix`);
console.log(`  Mail:  ${config.jmapToken ? "✓" : "✗"} JMAP`);
console.log(`  Drive: ${config.cozyToken ? "✓" : "✗"} Cozy`);
console.log(`  AI:    ${config.hfToken ? "✓ LUCIE" : config.openaiKey ? "✓ OpenAI" : "✗ (set HF_TOKEN for LUCIE)"}`);
console.log("");

// Filter to only enabled workflows with available triggers
const activeWorkflows = workflows.filter((wf) => {
  if (wf.enabled === false) return false;
  if (wf.trigger.type === "chat:message" && !config.matrixToken) return false;
  if (wf.trigger.type === "mail:new" && !config.jmapToken) return false;
  if (wf.trigger.type === "drive:upload" && !config.cozyToken) return false;
  return true;
});

if (!activeWorkflows.length) {
  console.log("No active workflows. Configure services via env vars and add workflows to workflows.json");
  process.exit(0);
}

engine.loadWorkflows(activeWorkflows);
engine.start();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await engine.stop();
  process.exit(0);
});
