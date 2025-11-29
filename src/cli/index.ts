#!/usr/bin/env node

import { Command } from "commander";
import { VERSION } from "../core/index.js";

const program = new Command();

program
  .name("re64")
  .description("A collaborative C64 disassembler");

program
  .command("version")
  .description("Show version number")
  .action(() => {
    console.log(VERSION);
  });

program.parse();
