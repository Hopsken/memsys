import type { Provider } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

interface ProviderFactory {
  create: (baseUrl?: string) => Provider;
}

// pi-ai hard-codes the DeepSeek endpoint, but a deployment may route through a
// proxy or a compatible gateway. Carrying the override on the auth result is
// how a provider changes the endpoint per request.
const withEndpoint = (provider: Provider, baseUrl: string): Provider => {
  const { apiKey } = provider.auth;
  if (!apiKey) {
    return provider;
  }
  return {
    ...provider,
    auth: {
      ...provider.auth,
      apiKey: {
        ...apiKey,
        resolve: async (input) => {
          const resolved = await apiKey.resolve(input);
          return resolved
            ? { ...resolved, auth: { ...resolved.auth, baseUrl } }
            : undefined;
        },
      },
    },
    baseUrl,
  };
};

// One place names the model provider. Tests replace the factory to run the
// subagent against a scripted provider.
export const providers: ProviderFactory = {
  create: (baseUrl) => {
    const provider = deepseekProvider();
    const endpoint = baseUrl?.trim().replace(/\/+$/u, "");
    return endpoint ? withEndpoint(provider, endpoint) : provider;
  },
};

export const createProvider = (baseUrl?: string) => providers.create(baseUrl);
