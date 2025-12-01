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
  findFile,
  extractFile,
  listDirectory,
  disassemble,
  formatInstruction,
  InstructionIndex,
  Project,
  parseProject,
  parseProjectAddress,
  projectLabelsToLabels,
  projectRegionsToRegions,
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

/** Result of loading layers */
interface LoadResult {
  map: MemoryMap;
  prgEntries: number[];
  userLabels: LabelIndex;
  userRegions: RegionIndex;
}

/** Load a project file and build the memory map */
function loadProject(projectPath: string): { project: Project; result: LoadResult } {
  const json = readFileSync(projectPath, "utf-8");
  const project = parseProject(json);
  const baseDir = dirname(projectPath);

  const map = new MemoryMap();
  const prgEntries: number[] = [];
  const userLabels = new LabelIndex();
  let layerCount = 0;

  for (const layer of project.layers) {
    layerCount++;
    const name = `layer${layerCount}`;

    if (layer.type === "prg") {
      const fullPath = resolve(baseDir, layer.path!);
      const { start, data, isPrg } = loadFile(fullPath, layer.address);
      const suppressEntry = layer.noAutoEntry ?? false;
      // isPrg determines default region kind (code), suppressEntry only affects auto entry label
      map.addLayer(new FileLayer(name, layer.path!, start, data, undefined, isPrg, suppressEntry));
      if (isPrg && !suppressEntry) {
        prgEntries.push(start);
      }
    } else if (layer.type === "raw") {
      const fullPath = resolve(baseDir, layer.path!);
      const addr = parseProjectAddress(layer.address!);
      const { data } = loadFile(fullPath, addr);
      if (layer.length !== undefined) {
        map.addLayer(new FileLayer(name, layer.path!, addr, data, layer.length));
      } else {
        map.addLayer(new FileLayer(name, layer.path!, addr, data));
      }
    } else if (layer.type === "bytes") {
      const addr = parseProjectAddress(layer.address!);
      const bytes = parseHexBytes(layer.bytes!);
      if (layer.length !== undefined) {
        map.addLayer(new BytesLayer(name, addr, bytes, layer.length));
      } else {
        map.addLayer(new BytesLayer(name, addr, bytes));
      }
    }
  }

  // Load user labels
  if (project.labels) {
    const labels = projectLabelsToLabels(project.labels);
    userLabels.addLabels(labels);
  }

  // Load user regions
  const userRegions = new RegionIndex();
  if (project.regions) {
    const regions = projectRegionsToRegions(project.regions);
    userRegions.addRegions(regions);
  }

  return { project, result: { map, prgEntries, userLabels, userRegions } };
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

program
  .command("disasm")
  .description("Disassemble code from entry points")
  .option("-p, --project <file>", "Project file (.re64)")
  .option("-l, --layer <spec...>", layerHelp)
  .option("-e, --entry <addr...>", "Entry point addresses (default: use PRG load addresses)")
  .option("-r, --range <range>", "Only show instructions in range")
  .action((options) => {
    let map: MemoryMap;
    let prgEntries: number[] = [];
    let userLabels = new LabelIndex();
    let userRegions = new RegionIndex();
    let projectEntryPoints: number[] | undefined;

    if (options.project) {
      // Load from project file
      const { project, result } = loadProject(options.project);
      map = result.map;
      prgEntries = result.prgEntries;
      userLabels = result.userLabels;
      userRegions = result.userRegions;

      if (project.entryPoints) {
        projectEntryPoints = project.entryPoints.map(parseProjectAddress);
      }
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

    // Determine entry points (CLI -e overrides project entryPoints)
    let entryPoints: number[];
    if (options.entry) {
      entryPoints = options.entry.map(parseAddress);
    } else if (projectEntryPoints && projectEntryPoints.length > 0) {
      entryPoints = projectEntryPoints;
    } else if (prgEntries.length > 0) {
      entryPoints = prgEntries;
    } else {
      const layers = map.getLayers();
      if (layers.length === 0) {
        console.error("No layers defined and no entry points specified");
        process.exit(1);
      }
      entryPoints = [Math.min(...layers.map((l) => l.start))];
    }

    // Build region index: merge auto-generated regions with user regions (user takes priority)
    const allRegions = new RegionIndex();
    allRegions.addRegions(map.getRegions().getAllRegions());
    allRegions.addRegions(userRegions.getAllRegions());

    // Disassemble
    const result = disassemble(map, { entryPoints, regions: allRegions });
    const index = new InstructionIndex(result.instructions);

    // Determine output range
    let instructions = index.all();
    if (options.range) {
      const { start, length } = parseRange(options.range);
      instructions = index.range(start, start + length);
    }

    // Merge labels from map, user labels, and region-generated labels
    const mapLabels = map.getLabels();
    const regionLabels = allRegions.generateLabels();
    const allLabels = new LabelIndex();
    allLabels.addLabels(mapLabels.getAllLabels());
    allLabels.addLabels(regionLabels);
    allLabels.addLabels(userLabels.getAllLabels());

    // Create label resolver for operand formatting
    const resolveLabel = (addr: number): string | undefined => {
      const labels = allLabels.getLabelsAt(addr);
      if (labels.length > 0) {
        return labels[0].name;
      }
      return undefined;
    };

    // Determine the full range to output (including data gaps)
    const layers = map.getLayers();
    let rangeStart: number, rangeEnd: number;
    if (options.range) {
      const { start, length } = parseRange(options.range);
      rangeStart = start;
      rangeEnd = start + length;
    } else if (layers.length > 0) {
      rangeStart = Math.min(...layers.map((l) => l.start));
      rangeEnd = Math.max(...layers.map((l) => l.end));
    } else {
      rangeStart = 0;
      rangeEnd = 0;
    }

    // Helper to format address
    const formatAddr = (addr: number) => addr.toString(16).toUpperCase().padStart(4, "0");

    // Helper to output labels at an address (deduplicated by name)
    const outputLabels = (addr: number) => {
      const labelsHere = allLabels.getLabelsAt(addr);
      const seenNames = new Set<string>();
      for (const label of labelsHere) {
        if (!seenNames.has(label.name)) {
          seenNames.add(label.name);
          console.log(`${formatAddr(addr)} ${label.name}:`);
        }
      }
    };

    // Helper to output a hex dump line (for data bytes)
    const outputDataLine = (addr: number, bytes: number[]) => {
      const bytesStr = bytes
        .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
        .join(" ");
      const asciiStr = bytes
        .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
        .join("");
      console.log(`${formatAddr(addr)}  ${bytesStr.padEnd(23)}  |${asciiStr}|`);
    };

    // Helper to output a text region line
    // Shows bytes with .TEXT directive - interpretation depends on the game's charset
    const outputTextLine = (addr: number, bytes: number[]) => {
      const bytesStr = bytes
        .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
        .join(" ");
      console.log(`${formatAddr(addr)}  ${bytesStr.padEnd(23)}  .TEXT`);
    };

    // Helper to output a jumptable entry
    const outputJumptableEntry = (addr: number) => {
      const lo = map.readByte(addr);
      const hi = map.readByte(addr + 1);
      if (lo !== undefined && hi !== undefined) {
        const target = lo | (hi << 8);
        const targetStr = formatAddr(target);
        const label = resolveLabel(target);
        const bytesStr = `${lo.toString(16).toUpperCase().padStart(2, "0")} ${hi.toString(16).toUpperCase().padStart(2, "0")}`;
        if (label) {
          console.log(`${formatAddr(addr)}  ${bytesStr.padEnd(8)}  .WORD ${label}`);
        } else {
          console.log(`${formatAddr(addr)}  ${bytesStr.padEnd(8)}  .WORD $${targetStr}`);
        }
      }
    };

    // Walk through the range, outputting instructions and data
    let addr = rangeStart;
    while (addr < rangeEnd) {
      // Check if there's an instruction at this address
      const instr = index.get(addr);

      if (instr) {
        // Output instruction
        outputLabels(addr);
        const bytesStr = [...instr.bytes]
          .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
          .join(" ")
          .padEnd(8);
        console.log(`${formatAddr(addr)}  ${bytesStr}  ${formatInstruction(instr, resolveLabel)}`);
        addr += instr.bytes.length;
      } else {
        // Not an instruction - check what kind of region this is
        const region = allRegions.getRegionAt(addr);
        const regionKind = region?.kind ?? "data";

        if (regionKind === "jumptable") {
          // Output jumptable entries (2 bytes each)
          outputLabels(addr);
          outputJumptableEntry(addr);
          addr += 2;
        } else if (regionKind === "text") {
          // Output text region
          const dataBytes: number[] = [];
          let lineStartAddr = addr;
          const BYTES_PER_LINE = 8;

          while (addr < rangeEnd && !index.has(addr)) {
            const currentRegion = allRegions.getRegionAt(addr);
            if (currentRegion?.kind !== "text") break;
            if (dataBytes.length > 0 && allLabels.hasLabelAt(addr)) break;

            const byte = map.readByte(addr);
            if (byte === undefined) {
              if (dataBytes.length > 0) {
                outputLabels(lineStartAddr);
                outputTextLine(lineStartAddr, dataBytes.splice(0));
              }
              addr++;
              lineStartAddr = addr;
              continue;
            }

            dataBytes.push(byte);
            addr++;

            if (dataBytes.length === BYTES_PER_LINE) {
              outputLabels(lineStartAddr);
              outputTextLine(lineStartAddr, dataBytes.splice(0));
              lineStartAddr = addr;
            }
          }

          if (dataBytes.length > 0) {
            outputLabels(lineStartAddr);
            outputTextLine(lineStartAddr, dataBytes);
          }
        } else {
          // Regular data - accumulate bytes until we hit an instruction or label
          const dataBytes: number[] = [];
          let lineStartAddr = addr;
          const BYTES_PER_LINE = 8;

          while (addr < rangeEnd && !index.has(addr)) {
            // Break at label boundaries (except at start of data block)
            if (dataBytes.length > 0 && allLabels.hasLabelAt(addr)) {
              break;
            }
            // Break if we enter a different region type
            const currentRegion = allRegions.getRegionAt(addr);
            const currentKind = currentRegion?.kind ?? "data";
            if (currentKind === "jumptable" || currentKind === "text") {
              break;
            }

            const byte = map.readByte(addr);
            if (byte === undefined) {
              if (dataBytes.length > 0) {
                outputLabels(lineStartAddr);
                outputDataLine(lineStartAddr, dataBytes.splice(0));
              }
              addr++;
              lineStartAddr = addr;
              continue;
            }

            dataBytes.push(byte);
            addr++;

            if (dataBytes.length === BYTES_PER_LINE) {
              outputLabels(lineStartAddr);
              outputDataLine(lineStartAddr, dataBytes.splice(0));
              lineStartAddr = addr;
            }
          }

          if (dataBytes.length > 0) {
            outputLabels(lineStartAddr);
            outputDataLine(lineStartAddr, dataBytes);
          }
        }
      }
    }

    // Show warnings
    if (result.warnings.length > 0) {
      console.error("");
      console.error("Warnings:");
      for (const w of result.warnings) {
        const addr = w.address.toString(16).toUpperCase().padStart(4, "0");
        switch (w.type) {
          case "undefined":
            console.error(`  $${addr}: undefined bytes`);
            break;
          case "truncated":
            console.error(`  $${addr}: truncated instruction (needed ${w.needed}, got ${w.available})`);
            break;
          case "overlap":
            const existing = w.existingAddress.toString(16).toUpperCase().padStart(4, "0");
            console.error(`  $${addr}: overlaps instruction at $${existing}`);
            break;
        }
      }
    }
  });

program.parse();
