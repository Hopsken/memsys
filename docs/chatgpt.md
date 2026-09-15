# Use memsys in ChatGPT

Connect the deployed memsys MCP server to ChatGPT with Cloudflare Access Managed OAuth. This guide covers a private developer-mode connection, not publication in the plugin directory.

## Connection settings

| Setting | Value |
| --- | --- |
| Name | `memsys` |
| Description | `Store and recall short memory fragments linked by hashtags.` |
| MCP server URL | `https://memsys.hopsken.com/mcp` |
| Transport | Streamable HTTP |
| Authentication | OAuth |
| Client registration | Dynamic client registration (DCR) |
| OAuth issuer | `https://hopsken.cloudflareaccess.com` |

Use the deployed URL, not the orb portal or the website root. The root has no homepage. ChatGPT cannot use the orb's browser login as Cloudflare Access authentication.

The live discovery documents checked on September 15, 2026 advertised DCR, authorization-code flow, refresh tokens, and PKCE `S256`. They did not advertise Client ID Metadata Documents (CIMD) or RFC 9207 issuer identification. A complete ChatGPT login and tool call has not yet been verified for this deployment. Use the checks below to verify the connection.

## 1. Prepare Cloudflare Access

An administrator must configure the Access application for `memsys.hopsken.com`:

1. Protect the whole hostname, including `/mcp` and `/api/*`.
2. Add an Allow policy for the users who can use this memory service. Do not add an authentication Bypass policy.
3. In **Advanced settings**, enable **Managed OAuth** and dynamic client registration.
4. Set **Allowed redirect URIs** as described below.
5. Save the application.

The Worker's `ACCESS_ISSUER` and `ACCESS_AUD` must match this Access application. The audience is the Access application audience tag, not the MCP URL. Do not change it to `https://memsys.hopsken.com/mcp`.

### Allow the ChatGPT callback

Use the exact redirect URI shown on the ChatGPT MCP connection's management page when it is available. Do not create a callback ID yourself.

For authorization servers without RFC 9207 issuer identification, the documented callback format is:

```text
https://chatgpt.com/connector/oauth/{callback_id}
```

`{callback_id}` is a placeholder. Do not paste it literally into Access.

If ChatGPT does not show a callback URI before connection, Cloudflare supports this path-specific wildcard as an initial allowlist entry:

```text
https://chatgpt.com/connector/oauth/*
```

This permits all callback IDs under that ChatGPT path. It is broader than an exact URI. After obtaining the actual URI, replace the wildcard with the exact address when practical. Do not allow all of `https://chatgpt.com/*`.

Older connections, and eligible servers with issuer identification, can use this stable callback instead:

```text
https://chatgpt.com/connector_platform_oauth_redirect
```

Add that exact address only if ChatGPT shows or uses it. The path wildcard above does not cover it. Do not enable localhost or loopback callbacks just for ChatGPT.

To find the actual callback during login, inspect the `redirect_uri` query parameter in the browser's OAuth authorization URL and URL-decode it. If registration fails before a browser opens, use the path wildcard to retry. Do not share full authorization URLs or network logs: they can contain codes, state values, or credentials.

## 2. Add the server in ChatGPT

OpenAI's current instructions use the following web interface. Labels and availability can differ by account or workspace policy.

1. Open **Settings → Security and login → Developer mode** and enable it.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins) and select the plus button to add an MCP connection.
3. Enter the name and description from the table above.
4. Select a public HTTPS connection and enter `https://memsys.hopsken.com/mcp`.
5. Select **OAuth**, not No Authentication or Mixed Authentication. Access protects the whole server, including initialization and tool discovery.
6. Choose **DCR** if the interface asks for a client registration method. Do not choose CIMD unless Cloudflare later advertises support for it.
7. For DCR, leave optional static Client ID and Client Secret fields empty. ChatGPT obtains the client credentials through registration. Do not put an Access service token, audience tag, or user token in those fields.
8. Create the connection and complete the Cloudflare Access login when prompted. Use an identity permitted by the Access policy.
9. Check the discovered tools: `remember`, `recall`, `revise`, and `forget`.

Use the normal login page. Never paste Access tokens into a chat message. This server uses user OAuth, not machine-to-machine service-token authentication.

## 3. Test the four memory operations

Start a new conversation. Add memsys from the tools menu; in developer mode this can appear under the composer's **Developer mode** tool. Approve write actions when ChatGPT asks.

Use disposable data for the first test:

| Step | Example prompt | Check |
| --- | --- | --- |
| Remember | `Use memsys remember to store exactly: ChatGPT connection test: prefer short answers. #chatgpt-test` | A tool result returns the stored text and a ref. |
| Recall | `Use memsys recall with the cue "ChatGPT connection test".` | The recalled list contains that fragment. |
| Revise | `Use memsys revise to replace that fragment with: ChatGPT connection test: prefer detailed answers. #chatgpt-test` | ChatGPT uses the returned ref; the ref stays the same and the text changes. |
| Verify revision | `Use memsys recall with the cue "ChatGPT connection test" again.` | The new text is returned. |
| Forget | `Use memsys forget to delete only the test fragment using its ref.` | The tool reports that ref as deleted. |
| Verify deletion | `Use memsys recall with the cue "ChatGPT connection test" again.` | The deleted fragment is absent. |

Inspect the actual tool calls and results, not only ChatGPT's prose. Connecting memsys does not enable automatic storage of every conversation, and memsys is separate from ChatGPT's built-in Memory feature.

Recall matches a case-insensitive phrase, not semantic meaning. Shared hashtags add related fragments. For routine use, store one idea per fragment and use explicit anchors such as `#project/memsys`. See the [memory rules](../README.md#memory-rules) for limits and matching behavior.

The verified Access identity selects the memory space. Two clients using the same Access identity share memory; different Access identities have separate memory spaces. ChatGPT conversations do not create separate spaces.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Developer mode or the create button is missing | Check account eligibility and workspace administrator policy. Use the current OpenAI connection guide linked below. |
| Callback ID is not visible | Use the path-specific wildcard above, then obtain the exact `redirect_uri`. The ID is not in the memsys repository. |
| Redirect URI rejected | Check the actual URI against the Access allowlist. The stable callback and callback-ID path are different. |
| `invalid_client` | Confirm DCR is enabled and supported. Keep the registered client and its secret valid; reconnect or recreate the ChatGPT connection if its credentials were removed. |
| Access denies login | Check the user identity and Access Allow policy. Do not disable authentication to work around it. |
| `401` before login | Expected. Access should return a `WWW-Authenticate` header pointing to discovery metadata. |
| `401` continues after login | Check registration, token exchange, and refresh with MCP Inspector. If the response comes from the Worker, check its Access issuer and audience. |
| `403` from the Worker with `Untrusted origin` | The request supplied a cross-origin `Origin`. The server currently does not support cross-origin browser clients. Do not add a CORS wildcard to fix OAuth callbacks; callback allowlisting is a separate Access setting. |
| Root returns `404`, or opening `/mcp` returns `405` after login | There is no homepage. MCP uses POST requests; entering the URL in a browser is not a tool test. |
| No memories appear | Check the Access identity and use a phrase present in the fragment. ChatGPT's built-in memories are not imported. |
| Tools or descriptions are stale | Refresh the connection metadata and start a new conversation. |

### Check discovery without credentials

These requests are read-only:

```sh
curl -i https://memsys.hopsken.com/mcp
curl -sS https://memsys.hopsken.com/.well-known/cloudflare-access-protected-resource/mcp
curl -sS https://hopsken.cloudflareaccess.com/.well-known/oauth-authorization-server
```

Expect a `401` OAuth challenge from the first request and JSON discovery documents from the other two. Follow the `resource_metadata` URL in the challenge if Cloudflare changes its path. The advertised MCP resource should be `https://memsys.hopsken.com/mcp`, and the issuer should be `https://hopsken.cloudflareaccess.com`. Authorization metadata must include PKCE `S256` and a registration endpoint for DCR.

Cloudflare handles discovery, registration, authorization, and token exchange. It validates the opaque OAuth bearer token and forwards a signed Access JWT to the Worker. The Worker verifies that assertion before selecting a user's memory. No callback route or OAuth server is needed in Hono.

## References

- [OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI: Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI: ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
- [Cloudflare: Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
