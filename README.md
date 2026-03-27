# twake-automate

Automation engine for [Twake Workplace](https://linagora.com/en/twake-workplace) — the missing workflow layer.

Slack has Workflow Builder. Microsoft has Power Automate. Google has Apps Script. **Twake has twake-automate.**

## What it does

Watches for events across Twake Chat, Mail, and Drive, evaluates declarative rules, and executes actions — including AI-powered email classification via [LUCIE](https://huggingface.co/OpenLLM-France/Lucie-7B-Instruct-v1.2) (Linagora's open-source LLM).

```
[Chat Message] ──┐
[New Email]    ──┤── Engine ── Conditions ── Actions
[File Upload]  ──┤                           ├── Send chat message
[Schedule]     ──┘                           ├── Webhook (CI/CD, etc.)
                                             ├── Upload to Drive
                                             ├── AI classify (LUCIE)
                                             └── AI route to room
```

## Example Workflows

```json
{
  "id": "email-to-chat",
  "name": "Notify chat when new email arrives",
  "trigger": { "type": "mail:new" },
  "actions": [{
    "type": "chat:send",
    "params": {
      "room": "!teamRoom:twake.app",
      "message": "New email from {{event.from}}: {{event.subject}}"
    }
  }]
}
```

```json
{
  "id": "ai-email-router",
  "name": "Route emails to topic rooms using LUCIE",
  "trigger": { "type": "mail:new" },
  "actions": [{
    "type": "ai:route",
    "params": {
      "content": "{{event.subject}}: {{event.preview}}",
      "model": "lucie",
      "routes": {
        "finance": "!financeRoom:twake.app",
        "engineering": "!engRoom:twake.app"
      }
    }
  }]
}
```

```json
{
  "id": "deploy-command",
  "name": "Trigger CI/CD when someone says !deploy",
  "trigger": {
    "type": "chat:message",
    "filter": { "body": "/^!deploy/" }
  },
  "actions": [{
    "type": "webhook",
    "params": { "url": "https://ci.example.com/deploy" }
  }]
}
```

## Triggers

| Type | Source | Events |
|------|--------|--------|
| `chat:message` | Matrix | New message in any joined room |
| `mail:new` | JMAP | New email in inbox |
| `drive:upload` | Cozy | New file in Drive folder |
| `schedule` | Cron | Time-based (e.g., weekdays at 9am) |

## Actions

| Type | Description |
|------|-------------|
| `chat:send` | Post message to a Matrix room |
| `webhook` | HTTP POST to external URL |
| `drive:upload` | Save content as file in Drive |
| `ai:classify` | Classify content using LUCIE/LLM |
| `ai:summarize` | Summarize content using LUCIE/LLM |
| `ai:route` | Classify and route to destination |

## AI Integration

twake-automate integrates with Linagora's LUCIE LLM for intelligent automation:

- **Email routing** — Classify emails by topic and route to the right chat room
- **Urgency detection** — Flag urgent emails for immediate attention
- **Content summarization** — Summarize documents and post to chat

Supports three LLM backends:
- **LUCIE** — via Hugging Face Inference API (set `HF_TOKEN`)
- **Ollama** — local inference (set `OLLAMA_URL`)
- **OpenAI-compatible** — any compatible endpoint (set `OPENAI_URL`, `OPENAI_KEY`)

## Setup

```bash
git clone https://github.com/JacobiusMakes/twake-automate.git
cd twake-automate
cp workflows.example.json workflows.json
# Edit workflows.json with your room IDs
```

Zero dependencies. Node.js 18+ built-ins only.

## Run

```bash
MATRIX_TOKEN=your-token \
JMAP_TOKEN=your-token \
COZY_TOKEN=your-token \
HF_TOKEN=your-hf-token \
node src/index.js
```

## Template Variables

Actions support `{{variable}}` templates that reference event data:

| Variable | Description |
|----------|-------------|
| `{{event.from}}` | Sender email/user |
| `{{event.subject}}` | Email subject |
| `{{event.body}}` | Message body |
| `{{event.name}}` | Uploaded file name |
| `{{event.room}}` | Chat room ID |
| `{{event.sender}}` | Chat message sender |
| `{{results.actionId.field}}` | Output from a previous action |

## Architecture

```
twake-automate/
├── src/
│   ├── index.js              # Entry point, config, wiring
│   ├── engine/
│   │   └── workflow.js        # Core engine: event routing, conditions, templates
│   ├── triggers/
│   │   ├── chat-message.js    # Matrix /sync long-polling
│   │   ├── new-email.js       # JMAP inbox polling
│   │   ├── file-upload.js     # Cozy folder watching
│   │   └── schedule.js        # Cron-based scheduling
│   └── actions/
│       ├── send-chat.js       # Matrix message sending
│       ├── webhook.js         # HTTP POST to external URLs
│       ├── upload-drive.js    # Cozy file upload
│       └── ai-classify.js     # LUCIE/LLM classification and routing
├── workflows.example.json     # Example workflow definitions
└── README.md
```

## License

AGPL-3.0 (matching Linagora's licensing)
