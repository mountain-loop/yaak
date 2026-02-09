# MCP Client Plan

## Goal
Add an MCP client mode to Yaak so users can connect to and debug MCP servers.

## Core Design
- **Protocol layer:** Implement JSON‑RPC framing, message IDs, and notifications as the common core.
- **Transport interface:** Define an async trait with `connect`, `send`, `receive`, and `close` methods.
- **Transports:**
  - Start with **Standard I/O** for local development.
  - Reuse the existing HTTP stack for **HTTP streaming** next.
  - Leave hooks for **WebSocket** support later.

## Integration
- Register MCP as a new request type alongside REST, GraphQL, gRPC, and WebSocket.
- Allow per‑request transport selection (stdio or HTTP).
- Map inbound messages into a new MCP response model that feeds existing timeline and debug views.

## Testing and Dog‑fooding
- Convert Yaak's own MCP server to Standard I/O for local testing.
- Use it internally to validate protocol behavior and message flow.
- Add unit and integration tests for JSON‑RPC messaging and transport abstractions.

## Future Refinements
- Add WebSocket transport support once core paths are stable.
- Extend timelines for protocol‑level visualization layered over raw transport events.
- Implement version and capability negotiation between client and server.
