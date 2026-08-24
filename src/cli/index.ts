#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import {
  VERSION,
  MemoryMap,
  BytesLayer,
  FileLayer,
  LabelIndex,
  RegionIndex,
  createAutoLabel,
  findFile,
  extractFile,
  listDirectory,
  createC64PlatformLayer,
  disassemble,
  formatInstruction,
  InstructionIndex,
  ReferenceType,
  LoadedProject,
  buildMemoryMap,
  parseProject,
  Project,
  Row,
  analyze,
  formatRows,
  formatWarnings,
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

/** Check if string looks like a range (contains + or :) */
function isRange(value: string): boolean {
  return value.includes("+") || value.includes(":");
}

/** Check if string looks like an address (starts with $ or 0x or is numeric) */
function isAddress(value: string): boolean {
  return /^(\$|0x)?[0-9a-fA-F]+$/.test(value);
}

/** Parse hex string to bytes */
function parseHexBytes(hex: string): Uint8Array {
  const bytes = hex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? [];
  return new Uint8Array(bytes);
}

/** Load a project file and build the memory map */
function loadProject(projectPath: string): LoadedProject {
  const project = parseProject(readFileSync(projectPath, "utf-8"));
  const baseDir = dirname(projectPath);

  return buildMemoryMap(project, (path, explicitStart) =>
    loadFile(resolve(baseDir, path), explicitStart)
  );
}

/** Load file and return start address + data. Supports d64:filename syntax. */
function loadFile(
  path: string,
  explicitStart?: number
): { start: number; data: Uint8Array; isPrg: boolean } {
  let fullData: Uint8Array;

  if (path.includes(":")) {
    // Check if it's a d64 disk image with embedded filename
    const colonIndex = path.lastIndexOf(":");
    const possibleD64 = path.substring(0, colonIndex);
    const innerFilename = path.substring(colonIndex + 1);

    // Only treat as d64:filename if the part before : looks like a d64 file
    if (possibleD64.toLowerCase().endsWith(".d64")) {
      const diskImage = new Uint8Array(readFileSync(possibleD64));
      const entry = findFile(diskImage, innerFilename);
      if (!entry) {
        const entries = listDirectory(diskImage);
        const available = entries.map((e) => e.filename).join(", ");
        throw new Error(
          `File "${innerFilename}" not found in ${possibleD64}. Available: ${available}`
        );
      }
      fullData = extractFile(diskImage, entry);
    } else {
      // Not a d64, treat the whole thing as a path (might have : on Windows)
      fullData = new Uint8Array(readFileSync(path));
    }
  } else {
    fullData = new Uint8Array(readFileSync(path));
  }

  if (explicitStart !== undefined) {
    // Raw file at explicit address - not a PRG
    return { start: explicitStart, data: fullData, isPrg: false };
  }

  // PRG file: first two bytes are load address (little-endian)
  if (fullData.length < 3) {
    throw new Error(`File too small to be a PRG: ${path}`);
  }
  const start = fullData[0] | (fullData[1] << 8);
  const data = fullData.slice(2);
  return { start, data, isPrg: true };
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
  <file.prg>                - PRG file (address from header)
  <image.d64:name>          - PRG from D64 disk image
  <addr>,<file>             - raw file at address
  <range>,<file>            - raw file repeated to fill range
  <addr>,#<hex>             - inline bytes
  <range>,#<hex>            - inline bytes repeated to fill range`;

program
  .command("dump")
  .description("Hex dump memory with defined layers")
  .option("-l, --layer <spec...>", layerHelp)
  .option("-r, --range <range>", "Range to dump (start+len or start:end, default: all layers)")
  .action((options) => {
    const map = new MemoryMap();
    let fileCount = 0;
    let bytesCount = 0;

    if (options.layer) {
      for (const spec of options.layer) {
        const parts = spec.split(",");

        if (parts.length === 1) {
          // Just a file path - PRG file
          const path = parts[0];
          fileCount++;
          const { start, data, isPrg } = loadFile(path);
          map.addLayer(new FileLayer(`file${fileCount}`, path, start, data, undefined, isPrg));
        } else if (parts.length >= 2) {
          const [addrOrRange, source] = parts;

          if (source.startsWith("#")) {
            // Inline bytes
            bytesCount++;
            const hex = source.slice(1) + parts.slice(2).join("");
            const bytes = parseHexBytes(hex);

            if (isRange(addrOrRange)) {
              const range = parseRange(addrOrRange);
              map.addLayer(
                new BytesLayer(`bytes${bytesCount}`, range.start, bytes, range.length)
              );
            } else {
              map.addLayer(
                new BytesLayer(`bytes${bytesCount}`, parseAddress(addrOrRange), bytes)
              );
            }
          } else {
            // File at address or range
            fileCount++;
            const path = source;

            if (isRange(addrOrRange)) {
              const range = parseRange(addrOrRange);
              const { data } = loadFile(path, range.start);
              map.addLayer(
                new FileLayer(`file${fileCount}`, path, range.start, data, range.length)
              );
            } else {
              const start = parseAddress(addrOrRange);
              const { data } = loadFile(path, start);
              map.addLayer(new FileLayer(`file${fileCount}`, path, start, data));
            }
          }
        }
      }
    }

    let start: number, length: number;
    if (options.range) {
      ({ start, length } = parseRange(options.range));
    } else {
      const byteLayers = map.getLayers().filter((l) => l.hasBytes);
      if (byteLayers.length === 0) {
        start = 0;
        length = 0x100;
      } else {
        start = Math.min(...byteLayers.map((l) => l.start));
        const end = Math.max(...byteLayers.map((l) => l.end));
        length = end - start;
      }
    }

    console.log(hexDump(map, start, length));
  });

program
  .command("disasm")
  .description("Disassemble code from entry points")
  .option("-p, --project <file>", "Project file (.re64)")
  .option("-l, --layer <spec...>", layerHelp)
  .option("-e, --entry <addr...>", "Entry point addresses (default: use PRG load addresses)")
  .option("-r, --range <range>", "Only show instructions in range")
  .option("-t, --label-tolerance <n>", "Max offset for fuzzy label matching (default: 1)", "1")
  .action((options) => {
    let map: MemoryMap;
    let prgEntries: number[] = [];
    let userLabels = new LabelIndex();
    // Layers declared on the command line have no project file behind them.
    let project: Project = { layers: [] };

    if (options.project) {
      // Load from project file
      const loaded = loadProject(options.project);
      map = loaded.map;
      prgEntries = loaded.prgEntries;
      userLabels = loaded.userLabels;
      project = loaded.project;

    } else {
      // Load from command line options
      map = new MemoryMap();
      let fileCount = 0;
      let bytesCount = 0;

      if (options.layer) {
        for (const spec of options.layer) {
          const parts = spec.split(",");

          if (parts.length === 1) {
            const path = parts[0];
            fileCount++;
            const { start, data, isPrg } = loadFile(path);
            map.addLayer(new FileLayer(`file${fileCount}`, path, start, data, undefined, isPrg));
            if (isPrg) {
              prgEntries.push(start);
            }
          } else if (parts.length >= 2) {
            const [addrOrRange, source] = parts;

            if (source.startsWith("#")) {
              bytesCount++;
              const hex = source.slice(1) + parts.slice(2).join("");
              const bytes = parseHexBytes(hex);

              if (isRange(addrOrRange)) {
                const range = parseRange(addrOrRange);
                map.addLayer(
                  new BytesLayer(`bytes${bytesCount}`, range.start, bytes, range.length)
                );
              } else {
                map.addLayer(
                  new BytesLayer(`bytes${bytesCount}`, parseAddress(addrOrRange), bytes)
                );
              }
            } else {
              fileCount++;
              const path = source;

              if (isRange(addrOrRange)) {
                const range = parseRange(addrOrRange);
                const { data } = loadFile(path, range.start);
                map.addLayer(
                  new FileLayer(`file${fileCount}`, path, range.start, data, range.length)
                );
              } else {
                const start = parseAddress(addrOrRange);
                const { data } = loadFile(path, start);
                map.addLayer(new FileLayer(`file${fileCount}`, path, start, data));
              }
            }
          }
        }
      }
    }

    // The view model is shared with the web UI: one walk over the address
    // range, two renderers. Annotations are off because nothing in a terminal
    // is clickable, so type tags and xref stubs would only be noise.
    const analysis = analyze(
      { project, map, prgEntries, userLabels, layers: [] },
      {
        labelTolerance: parseInt(options.labelTolerance, 10) || 1,
        annotations: false,
        entryPoints: options.entry?.map(parseAddress),
      }
    );

    let rows = analysis.rows;
    if (options.range) {
      const { start, length } = parseRange(options.range);
      rows = rows.filter((r: Row) => r.address >= start && r.address < start + length);
    }

    for (const line of formatRows(rows)) {
      console.log(line);
    }

    if (analysis.warnings.length > 0) {
      console.error("");
      console.error("Warnings:");
      for (const line of formatWarnings(analysis.warnings)) {
        console.error(line);
      }
    }
  });

program.parse();
