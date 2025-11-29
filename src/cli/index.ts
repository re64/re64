#!/usr/bin/env node

import { Command } from "commander";
import {
  VERSION,
  MemoryMap,
  ConstantLayer,
  ArrayLayer,
} from "../core/index.js";
import { hexDump } from "./hex.js";

function parseAddress(value: string): number {
  const num = value.startsWith("0x") || value.startsWith("$")
    ? parseInt(value.replace("$", "0x"), 16)
    : parseInt(value, 10);
  if (isNaN(num) || num < 0 || num > 0xffff) {
    throw new Error(`Invalid address: ${value}`);
  }
  return num;
}

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

program
  .command("dump")
  .description("Hex dump memory with defined layers")
  .option("-c, --const <spec...>", "Add constant layer: name,start,length,value")
  .option("-a, --array <spec...>", "Add array layer: name,start,hexbytes")
  .option("-s, --start <addr>", "Start address for dump", "0")
  .option("-l, --length <len>", "Number of bytes to dump", "256")
  .action((options) => {
    const map = new MemoryMap();

    // Add constant layers (bottom to top as specified)
    if (options.const) {
      for (const spec of options.const) {
        const [name, start, length, value] = spec.split(",");
        map.addLayer(
          new ConstantLayer(
            name,
            parseAddress(start),
            parseAddress(length),
            parseAddress(value)
          ),
          map.getLayerCount() // add at bottom
        );
      }
    }

    // Add array layers on top (later options shadow earlier ones)
    if (options.array) {
      for (const spec of options.array) {
        const parts = spec.split(",");
        const name = parts[0];
        const start = parseAddress(parts[1]);
        const hexBytes = parts.slice(2).join("");
        const bytes = new Uint8Array(
          hexBytes.match(/.{2}/g)?.map((b: string) => parseInt(b, 16)) ?? []
        );
        map.addLayer(new ArrayLayer(name, start, bytes)); // add at top
      }
    }

    const startAddr = parseAddress(options.start);
    const length = parseInt(options.length, 10);

    console.log(hexDump(map, startAddr, length));
  });

program.parse();
