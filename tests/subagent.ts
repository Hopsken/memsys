import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type {
  FauxResponseStep,
  JsonObject,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach } from "vitest";

import { providers } from "../worker/services/memory/provider";
import { faux } from "./faux-provider";

export interface ModelRequest {
  context: TranscriptContext;
  options: SimpleStreamOptions | undefined;
}

const real = providers.create;

// The Worker's module graph runs outside Vitest's module registry, so a module
// mock cannot reach it. It does share this factory object, which lets each test
// script the model without touching production wiring.
export const useFauxModel = () => {
  beforeEach(() => {
    providers.create = () => faux.provider;
    faux.setResponses([]);
  });
  afterEach(() => {
    providers.create = real;
    faux.setResponses([]);
  });
};

export const scripted = () => {
  const requests: ModelRequest[] = [];
  const record = (
    context: TranscriptContext,
    options: SimpleStreamOptions | undefined
  ) => {
    requests.push({ context, options });
  };
  return {
    fail:
      (message: string): FauxResponseStep =>
      (context, options) => {
        record(context, options);
        return fauxAssistantMessage([], {
          errorMessage: message,
          stopReason: "error",
        });
      },
    requests,
    text:
      (value: string): FauxResponseStep =>
      (context, options) => {
        record(context, options);
        return fauxAssistantMessage(value);
      },
    tool:
      (name: string, arguments_: JsonObject): FauxResponseStep =>
      (context, options) => {
        record(context, options);
        return fauxAssistantMessage(fauxToolCall(name, arguments_));
      },
    tools:
      (calls: [string, JsonObject][]): FauxResponseStep =>
      (context, options) => {
        record(context, options);
        return fauxAssistantMessage(
          calls.map(([name, arguments_]) => fauxToolCall(name, arguments_))
        );
      },
  };
};
