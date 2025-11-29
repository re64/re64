#!/usr/bin/env node

import { Command } from "commander";
import {
  VERSION,
  MemoryMap,
  BytesLayer,
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

interface Range {
  start: number;
  length: number;
}

/** Parse range: start+length or start:end */
function parseRange(value: string): Range {
  if (value.includes("+")) {
    const [startStr, lengthStr] = value.split("+");
    return { start: parseAddress(startStr), length: parseAddress(lengthStr) };
  }
  if (value.includes(":")) {
    const [startStr, endStr] = value.split(":");
    const start = parseAddress(startStr);
    const end = parseAddress(endStr);
    return { start, length: end - start };
  }
  throw new Error(`Invalid range: ${value} (use start+length or start:end)`);
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

const layerHelp = `Add a memory layer (later layers shadow earlier ones):
  bytes,<start>,<hex>         - exact bytes
  bytes,<range>,<hex>         - bytes repeated/truncated to fill range
                               (<range>: start+len or start:end)`;

program
  .command("dump")
  .description("Hex dump memory with defined layers")
  .option("-l, --layer <spec...>", layerHelp)
  .option("-r, --range <range>", "Range to dump (start+len or start:end, default: all layers)")
  .action((options) => {
    const map = new MemoryMap();
    const counts: Record<string, number> = {};

    if (options.layer) {
      for (const spec of options.layer) {
        const [type, ...rest] = spec.split(",");
        counts[type] = (counts[type] ?? 0) + 1;
        const name = `${type}${counts[type]}`;

        switch (type) {
          case "bytes": {
            const [addrOrRange, ...hexParts] = rest;
            const hexBytes = hexParts.join("");
            const bytes = new Uint8Array(
              hexBytes.match(/.{2}/g)?.map((b: string) => parseInt(b, 16)) ?? []
            );

            // Check if it's a range (has + or :) or just a start address
            if (addrOrRange.includes("+") || addrOrRange.includes(":")) {
              const range = parseRange(addrOrRange);
              map.addLayer(new BytesLayer(name, range.start, bytes, range.length));
            } else {
              map.addLayer(new BytesLayer(name, parseAddress(addrOrRange), bytes));
            }
            break;
          }
          default:
            throw new Error(`Unknown layer type: ${type}`);
        }
      }
    }

    let start: number, length: number;
    if (options.range) {
      ({ start, length } = parseRange(options.range));
    } else {
      const layers = map.getLayers();
      if (layers.length === 0) {
        start = 0;
        length = 0x100;
      } else {
        start = Math.min(...layers.map((l) => l.start));
        const end = Math.max(...layers.map((l) => l.end));
        length = end - start;
      }
    }

    console.log(hexDump(map, start, length));
  });

program.parse();
