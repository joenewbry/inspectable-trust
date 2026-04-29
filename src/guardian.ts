// Guardian — provider-agnostic LLM wrapper with prompt caching + cost tracking.
//
// We deliberately use plain fetch for both providers so the wire is
// inspectable. No SDK required at runtime.
//
// Provider selection:
//   TRUST_PROVIDER=anthropic (default) → uses ANTHROPIC_API_KEY
//   TRUST_PROVIDER=openai             → uses OPENAI_API_KEY
//
// Model defaults are cheap-and-fast in either case:
//   anthropic → claude-haiku-4-5-20251001
//   openai    → gpt-4.1-nano

import type { GuardianClient } from "./types.js";

export type Provider = "anthropic" | "openai";

export interface GuardianOptions {
  provider?: Provider;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** When true, system prompts are cached (Anthropic only). Default true. */
  cacheSystem?: boolean;
  /** Optional log sink for cost / call records. */
  onCall?: (info: GuardianCallInfo) => void;
}

export interface GuardianCallInfo {
  provider: Provider;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUSD: number;
  latencyMs: number;
}

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4.1-nano",
};

// Prices in USD per 1M tokens. Override via env.
const PRICING = {
  anthropic: {
    input: Number(process.env.TRUST_PRICE_INPUT ?? "1.0"),
    output: Number(process.env.TRUST_PRICE_OUTPUT ?? "5.0"),
    cacheRead: Number(process.env.TRUST_PRICE_CACHE_READ ?? "0.1"),
    cacheWrite: Number(process.env.TRUST_PRICE_CACHE_WRITE ?? "1.25"),
  },
  openai: {
    // gpt-4.1-nano: $0.10 input / $0.40 output per 1M (as of 2026-04).
    input: Number(process.env.TRUST_OPENAI_PRICE_INPUT ?? "0.10"),
    output: Number(process.env.TRUST_OPENAI_PRICE_OUTPUT ?? "0.40"),
    cacheRead: 0,
    cacheWrite: 0,
  },
};

export class Guardian implements GuardianClient {
  public provider: Provider;
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private cacheSystem: boolean;
  private onCall?: (info: GuardianCallInfo) => void;
  /** Running total cost in USD. */
  public cost = 0;
  /** Running call count. */
  public calls = 0;

  constructor(opts: GuardianOptions = {}) {
    this.provider =
      opts.provider ?? (process.env.TRUST_PROVIDER as Provider | undefined) ?? "anthropic";
    const envKey =
      this.provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY;
    this.apiKey = opts.apiKey ?? envKey ?? "";
    if (!this.apiKey) {
      throw new Error(
        `Guardian: no API key for provider "${this.provider}". Set ${this.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}.`,
      );
    }
    this.model = opts.model ?? process.env.TRUST_MODEL ?? DEFAULT_MODELS[this.provider];
    this.maxTokens = opts.maxTokens ?? 800;
    this.cacheSystem = opts.cacheSystem ?? true;
    if (opts.onCall) this.onCall = opts.onCall;
  }

  async ask(systemPrompt: string, userMessage: string): Promise<string> {
    const start = Date.now();
    const result =
      this.provider === "anthropic"
        ? await this.askAnthropic(systemPrompt, userMessage)
        : await this.askOpenAI(systemPrompt, userMessage);
    const latencyMs = Date.now() - start;

    const pricing = PRICING[this.provider];
    const costUSD =
      (result.inputTokens / 1_000_000) * pricing.input +
      (result.cacheReadTokens / 1_000_000) * pricing.cacheRead +
      (result.cacheWriteTokens / 1_000_000) * pricing.cacheWrite +
      (result.outputTokens / 1_000_000) * pricing.output;

    this.cost += costUSD;
    this.calls += 1;

    this.onCall?.({
      provider: this.provider,
      model: this.model,
      inputTokens: result.inputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      outputTokens: result.outputTokens,
      costUSD,
      latencyMs,
    });

    return result.text;
  }

  private async askAnthropic(systemPrompt: string, userMessage: string) {
    const systemBlock = this.cacheSystem
      ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
      : [{ type: "text", text: systemPrompt }];

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemBlock,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!resp.ok) {
      throw new Error(`anthropic ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      content: { type: string; text?: string }[];
      usage: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };
    const text = data.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n")
      .trim();
    return {
      text,
      inputTokens: data.usage.input_tokens ?? 0,
      outputTokens: data.usage.output_tokens ?? 0,
      cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
    };
  }

  private async askOpenAI(systemPrompt: string, userMessage: string) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!resp.ok) {
      throw new Error(`openai ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = (data.choices[0]?.message.content ?? "").trim();
    return {
      text,
      inputTokens: data.usage.prompt_tokens ?? 0,
      outputTokens: data.usage.completion_tokens ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  }
}

/** A Guardian that throws on every call. Used in tests for "should not call LLM" branches. */
export class NoCallGuardian implements GuardianClient {
  cost = 0;
  ask(): Promise<string> {
    throw new Error("NoCallGuardian: ask() should not have been called");
  }
}
