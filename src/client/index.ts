/**
 * A participant in a project, over the network.
 *
 * Used by the browser and by anything headless — an agent, a script, a test.
 * There is nothing DOM-specific here: `fetch`, `WebSocket` and `performance`
 * are all standard in Node, so the same client that draws the disassembly can
 * run without a page.
 *
 * That matters because the interesting difference between an agent and the CLI
 * is not overhead, it is **observation**. A CLI invocation opens the store,
 * makes one change and exits. A participant holds a live document, sees what
 * other people are doing, and is visible to them while it works.
 */

export * from "./doc-client.js";
export * from "./session.js";
