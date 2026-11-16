import type { Provider } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

interface ProviderFactory {
  create: () => Provider;
}

// One place names the model provider. Tests replace the factory to run the
// subagent against a scripted provider.
export const providers: ProviderFactory = {
  create: () => deepseekProvider(),
};

export const createProvider = () => providers.create();
