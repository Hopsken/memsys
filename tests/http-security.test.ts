import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import type { Fragment } from "../worker/memory";
import { list, post, useAccess } from "./helpers";

describe("HTTP request safety", () => {
  const token = useAccess();

  it.each(["/api/remember", "/api/revise", "/api/forget", "/mcp"] as const)(
    "blocks cross-origin writes to %s without changing memory",
    async (path) => {
      const jwt = await token(`origin-${path}`);
      const saved = await post(
        "/api/remember",
        { fragment: "Original memory" },
        jwt
      );
      const item = await saved.json<Fragment>();
      const bodies = {
        "/api/forget": { ref: item.ref },
        "/api/remember": { fragment: "Injected memory" },
        "/api/revise": { fragment: "Injected memory", ref: item.ref },
        "/mcp": {
          id: 1,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: { fragment: "Injected memory" },
            name: "remember",
          },
        },
      };
      const body = bodies[path];
      const response = await post(path, body, jwt, {
        Origin: "https://attacker.test",
        "Sec-Fetch-Site": "same-origin",
      });
      expect(response.status).toBe(403);
      await expect(list(jwt)).resolves.toStrictEqual({
        fragments: [item],
        nextCursor: null,
      });
    }
  );

  it.each(["null", "https://memsys.test.attacker.test", "http://memsys.test"])(
    "rejects untrusted Origin %s",
    async (origin) => {
      await expect(
        post("/mcp", {}, await token("origin"), { Origin: origin })
      ).resolves.toMatchObject({ status: 403 });
    }
  );

  it.each([
    "text/plain",
    "application/jsonp",
    "application/x-www-form-urlencoded",
    "",
  ])(
    "rejects REST media type %j without writing memory",
    async (contentType) => {
      const jwt = await token(`media-${contentType}`);
      const headers = new Headers({ "Cf-Access-Jwt-Assertion": jwt });
      if (contentType) {
        headers.set("Content-Type", contentType);
      }
      const response = await worker.fetch(
        new Request("https://memsys.test/api/remember", {
          body: new TextEncoder().encode('{"fragment":"Injected memory"}'),
          headers,
          method: "POST",
        }),
        env
      );
      expect(response.status).toBe(415);
      await expect(list(jwt)).resolves.toStrictEqual({
        fragments: [],
        nextCursor: null,
      });
    }
  );

  it.each(["/api/remember", "/mcp"])(
    "accepts same-origin JSON requests to %s",
    async (path) => {
      const body =
        path === "/mcp"
          ? { id: 1, jsonrpc: "2.0", method: "tools/list" }
          : { fragment: "Same-origin memory" };
      await expect(
        post(path, body, await token(`same-origin-${path}`), {
          "Content-Type": "application/json; charset=utf-8",
          Origin: "https://memsys.test",
        })
      ).resolves.toMatchObject({ status: path === "/mcp" ? 200 : 201 });
    }
  );
});
