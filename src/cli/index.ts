#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
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
  parseProjectAddress,
  Project,
  Row,
  analyze,
  formatRows,
  formatWarnings,
  migrateIds,
  newId,
} from "../core/index.js";
import { hexDump } from "./hex.js";
import {
  labelSetOp,
  owningLayerId,
  redoLast,
  regionSetOp,
  runOps,
  undoLast,
} from "./edit.js";

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

/**
 * Edits go through the same operation layer the web UI uses, and are recorded
 * beside the project so undo survives the process exiting.
 */
const label = program.command("label").description("Create, rename, or remove labels");

label
  .command("set")
  .description("Name an address")
  .argument("<project>", "Project file (.re64)")
  .argument("<address>", "Address, e.g. $81A2")
  .argument("<name>", "Label name")
  .option("-t, --type <type>", "entry | function | code | address")
  .option("-c, --comment <text>", "Attach a comment")
  .action((projectPath: string, addressArg: string, name: string, options) => {
    const address = parseAddress(addressArg);
    const layerId = owningLayerId(projectPath, address);
    const op = labelSetOp(projectPath, layerId, address, name, options.type, options.comment);
    const { descriptions } = runOps(projectPath, [op], "cli", Date.now());
    console.log(descriptions[0]);
  });

label
  .command("rm")
  .description("Remove the label at an address")
  .argument("<project>", "Project file (.re64)")
  .argument("<address>", "Address, e.g. $81A2")
  .action((projectPath: string, addressArg: string) => {
    const address = parseAddress(addressArg);
    const layerId = owningLayerId(projectPath, address);
    const project = parseProject(readFileSync(projectPath, "utf-8"));
    const layer = project.layers.find((l) => l.id === layerId);
    const existing = layer?.labels?.find((l) => parseProjectAddress(l.address) === address);
    if (!existing) {
      console.error(`No label at ${addressArg}`);
      process.exit(1);
    }
    const { descriptions } = runOps(
      projectPath,
      [{ op: "label.delete", id: existing.id!, layerId }],
      "cli",
      Date.now()
    );
    console.log(descriptions[0]);
  });

const region = program.command("region").description("Declare what a range of memory holds");

region
  .command("set")
  .description("Type a range of memory")
  .argument("<project>", "Project file (.re64)")
  .argument("<range>", "Range, e.g. $8080:$80A0 or $8080+$20")
  .argument("<kind>", "code | data | text | jumptable | unknown")
  .option("-n, --name <name>", "Name the region")
  .action((projectPath: string, rangeArg: string, kind: string, options) => {
    const { start, length } = parseRange(rangeArg);
    const layerId = owningLayerId(projectPath, start);
    const op = regionSetOp(projectPath, layerId, start, start + length, kind as never, options.name);
    const { descriptions } = runOps(projectPath, [op], "cli", Date.now());
    console.log(descriptions[0]);
  });

region
  .command("rm")
  .description("Remove the region starting at an address")
  .argument("<project>", "Project file (.re64)")
  .argument("<address>", "Region start, e.g. $8080")
  .action((projectPath: string, addressArg: string) => {
    const start = parseAddress(addressArg);
    const project = parseProject(readFileSync(projectPath, "utf-8"));
    for (const layer of project.layers) {
      const found = layer.regions?.find((r) => parseProjectAddress(r.start) === start);
      if (found) {
        const { descriptions } = runOps(
          projectPath,
          [{ op: "region.delete", id: found.id!, layerId: layer.id! }],
          "cli",
          Date.now()
        );
        console.log(descriptions[0]);
        return;
      }
    }
    console.error(`No region starting at ${addressArg}`);
    process.exit(1);
  });

program
  .command("apply")
  .description("Apply a batch of operations from a JSON file")
  .argument("<project>", "Project file (.re64)")
  .argument("<ops>", "JSON file holding an array of operations")
  .option("-a, --author <name>", "Who made these edits", "cli")
  .action((projectPath: string, opsPath: string, options) => {
    const ops = JSON.parse(readFileSync(opsPath, "utf-8"));
    if (!Array.isArray(ops)) {
      console.error("Expected a JSON array of operations");
      process.exit(1);
    }
    const { applied, descriptions } = runOps(projectPath, ops, options.author, Date.now());
    for (const line of descriptions) console.log(line);
    console.log(`Applied ${applied} operation${applied === 1 ? "" : "s"}.`);
  });

program
  .command("undo")
  .description("Undo the most recent edit")
  .argument("<project>", "Project file (.re64)")
  .action((projectPath: string) => {
    const undone = undoLast(projectPath);
    console.log(undone ? `Undid: ${undone}` : "Nothing to undo.");
  });

program
  .command("redo")
  .description("Redo the most recently undone edit")
  .argument("<project>", "Project file (.re64)")
  .action((projectPath: string) => {
    const redone = redoLast(projectPath);
    console.log(redone ? `Redid: ${redone}` : "Nothing to redo.");
  });

program
  .command("migrate")
  .description("Write stable ids into a project file")
  .argument("<file>", "Project file (.re64)")
  .action((file: string) => {
    const raw = readFileSync(file, "utf-8");
    const migrated = migrateIds(raw, (prefix) => newId(prefix));
    if (migrated === raw) {
      console.log("Already migrated; nothing to write.");
      return;
    }
    writeFileSync(file, migrated, "utf-8");
    const count = (text: string) => (text.match(/"id"\s*:/g) ?? []).length;
    console.log(`Wrote ${count(migrated) - count(raw)} ids to ${file}.`);
  });

program
  .command("disasm")
  .description("Disassemble code from entry points")
  .option("-p, --project <file>", "Project file (.re64)")
  .option("-l, --layer <spec...>", layerHelp)
  .option("-e, --entry <addr...>", "Entry point addresses (default: use PRG load addresses)")
  .option("-r, --range <range>", "Only show instructions in range")
  .option("-t, --label-tolerance <n>", "Max offset for fuzzy label matching (default: 1)", "1")
  .option("--no-arrows", "Hide the cross-reference arrow gutter")
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

    // Rows and their gutter are index-aligned, so a range has to slice both in
    // step or the arrows end up against the wrong lines.
    let kept = analysis.rows.map((_: Row, i: number) => i);
    if (options.range) {
      const { start, length } = parseRange(options.range);
      kept = kept.filter((i: number) => {
        const addr = analysis.rows[i].address;
        return addr >= start && addr < start + length;
      });
    }

    const rows = kept.map((i: number) => analysis.rows[i]);
    const arrows = options.arrows ? kept.map((i: number) => analysis.arrows[i]) : [];

    for (const line of formatRows(rows, arrows)) {
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

// Action handlers run synchronously during parse, so a bad project file or an
// unreadable path surfaces here. Report it as a message: a stack trace is noise
// when the fault is in the input rather than the code.
try {
  program.parse();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
