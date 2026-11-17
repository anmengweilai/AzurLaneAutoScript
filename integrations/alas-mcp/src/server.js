#!/usr/bin/env node
/**
 * Alas Control API MCP server.
 *
 * Speaks the Model Context Protocol over stdio, so stdout carries protocol
 * frames only — diagnostics go to stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { clientFromEnv } from './client.js';
import { registerAlasTools } from './tools.js';

const VERSION = '0.1.0';

export function createServer(client = clientFromEnv()) {
  const server = new McpServer({ name: 'alas-control', version: VERSION });
  registerAlasTools(server, client);
  return server;
}

async function main() {
  const client = clientFromEnv();
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[alas-mcp] connected, control API at ${client.baseUrl}\n`);
}

const isEntry = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((error) => {
    process.stderr.write(`[alas-mcp] fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
}