#!/usr/bin/env node
//
// Make a `.re64db` from a `.re64`.
//
//   node experiments/import.mjs <project.re64> [database.re64db]
//
// This was `re64 import` until the CLI was removed on 2026-09-07: agents use
// MCP and people use the web UI, so a third surface earned its keep for
// nobody. Setting up an experiment still needs a database to start a server
// on, and that is one function call rather than a command-line tool.
import { importProject } from "../dist/store/index.js";

const [project, database] = process.argv.slice(2);
if (!project) {
  console.error("usage: node experiments/import.mjs <project.re64> [database.re64db]");
  process.exit(1);
}
const result = database ? importProject(project, database) : importProject(project);
console.log(result.databasePath);
