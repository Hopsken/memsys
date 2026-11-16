import { fauxProvider } from "@earendil-works/pi-ai";

// Stands in for the DeepSeek provider in tests. It keeps the production
// provider id and model id, and records every request it receives.
export const faux = fauxProvider({
  models: [
    {
      contextWindow: 1_000_000,
      id: "deepseek-flash",
      maxTokens: 384_000,
      name: "DeepSeek V4.1 Flash",
      reasoning: true,
    },
  ],
  provider: "deepseek",
});
