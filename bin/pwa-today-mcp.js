#!/usr/bin/env node

import { start } from '../src/index.js';

start().catch((error) => {
  console.error('PWA Today MCP server could not start.', {
    name: error.name
  });
  process.exitCode = 1;
});
