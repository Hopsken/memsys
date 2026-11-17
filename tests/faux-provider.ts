import { fauxProvider } from "@earendil-works/pi-ai";

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
