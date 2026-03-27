/**
 * AI Classify Action — uses LUCIE (or any LLM) to classify content
 * and route it to the appropriate destination.
 *
 * This is the bridge between Linagora's AI strategy (LUCIE) and their
 * collaboration suite (Twake). It enables intelligent automation:
 *
 * - Classify emails by urgency/topic → route to correct Matrix room
 * - Summarize documents uploaded to Drive → post summary to chat
 * - Detect action items in chat messages → create follow-ups
 * - Auto-tag files based on content analysis
 *
 * Supports multiple LLM backends:
 * - LUCIE (Linagora's open-source LLM via Hugging Face Inference API)
 * - OpenAI-compatible endpoints (for self-hosted models)
 * - Ollama (local inference)
 *
 * Action config:
 *   type: "ai:classify"
 *   params:
 *     prompt: "Classify this email into one of: urgent, normal, spam.\n\nFrom: {{event.from}}\nSubject: {{event.subject}}\nBody: {{event.preview}}"
 *     model: "lucie" | "openai" | "ollama"
 *     outputField: "classification"   — stores result in context.results
 *
 *   type: "ai:summarize"
 *   params:
 *     text: "{{event.body}}"
 *     maxLength: 200
 *     outputField: "summary"
 *
 *   type: "ai:route"
 *   params:
 *     content: "{{event.subject}}: {{event.preview}}"
 *     routes:
 *       finance: "!financeRoom:twake.app"
 *       engineering: "!engRoom:twake.app"
 *       urgent: "!urgentRoom:twake.app"
 *     default: "!generalRoom:twake.app"
 */

export class AIClassifyAction {
  constructor(config) {
    this.lucieEndpoint = config.lucieEndpoint || "https://api-inference.huggingface.co/models/OpenLLM-France/Lucie-7B-Instruct-v1.2";
    this.lucieToken = config.lucieToken || config.hfToken;
    this.ollamaUrl = config.ollamaUrl || "http://localhost:11434";
    this.openaiUrl = config.openaiUrl;
    this.openaiKey = config.openaiKey;
    this.defaultModel = config.defaultAiModel || "lucie";
  }

  async execute(params) {
    const model = params.model || this.defaultModel;
    const prompt = params.prompt || params.text;
    if (!prompt) throw new Error("ai:classify requires 'prompt' or 'text'");

    let result;

    switch (model) {
      case "lucie":
        result = await this.callLucie(prompt, params);
        break;
      case "ollama":
        result = await this.callOllama(prompt, params);
        break;
      case "openai":
        result = await this.callOpenAI(prompt, params);
        break;
      default:
        throw new Error(`Unknown AI model: ${model}. Supported: lucie, ollama, openai`);
    }

    return { [params.outputField || "aiResult"]: result, model };
  }

  /**
   * Call LUCIE via Hugging Face Inference API.
   *
   * LUCIE-7B-Instruct uses a chat template format:
   *   [INST] {system prompt} [/INST]
   *   [INST] {user message} [/INST]
   */
  async callLucie(prompt, params) {
    if (!this.lucieToken) {
      throw new Error("LUCIE requires HF_TOKEN (Hugging Face API token)");
    }

    const systemPrompt = params.systemPrompt || "You are a helpful assistant that classifies and summarizes content. Respond concisely.";

    const res = await fetch(this.lucieEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.lucieToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: `[INST] ${systemPrompt} [/INST]\n[INST] ${prompt} [/INST]`,
        parameters: {
          max_new_tokens: params.maxLength || 200,
          temperature: params.temperature || 0.3,
          return_full_text: false,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`LUCIE API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return Array.isArray(data) ? data[0]?.generated_text?.trim() : String(data);
  }

  /**
   * Call a local Ollama instance.
   */
  async callOllama(prompt, params) {
    const res = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: params.ollamaModel || "llama3",
        prompt,
        stream: false,
        options: {
          num_predict: params.maxLength || 200,
          temperature: params.temperature || 0.3,
        },
      }),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json();
    return data.response?.trim();
  }

  /**
   * Call an OpenAI-compatible endpoint.
   */
  async callOpenAI(prompt, params) {
    const url = this.openaiUrl || "https://api.openai.com/v1/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.openaiModel || "gpt-4o-mini",
        messages: [
          { role: "system", content: params.systemPrompt || "Classify and summarize concisely." },
          { role: "user", content: prompt },
        ],
        max_tokens: params.maxLength || 200,
        temperature: params.temperature || 0.3,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim();
  }
}

/**
 * AI Route Action — classify content and return the target room/destination.
 *
 * Uses LUCIE to determine which category content belongs to, then maps
 * it to a configured destination (Matrix room, webhook, etc.).
 */
export class AIRouteAction extends AIClassifyAction {
  async execute(params) {
    const { content, routes, default: defaultRoute } = params;
    if (!content || !routes) throw new Error("ai:route requires 'content' and 'routes'");

    const categories = Object.keys(routes).join(", ");
    const prompt = `Classify the following content into exactly one category: ${categories}.\n\nContent: ${content}\n\nRespond with only the category name, nothing else.`;

    const result = await super.execute({
      ...params,
      prompt,
      outputField: "_category",
    });

    const category = result._category?.toLowerCase().trim();
    const destination = routes[category] || defaultRoute;

    return { category, destination, content };
  }
}
