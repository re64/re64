import { MemoryMap, LabelIndex } from "../core/index.js";

export interface HexDumpOptions {
  bytesPerLine?: number;
  showAscii?: boolean;
  showLabels?: boolean;
}

/** Format an address as 4-digit uppercase hex */
function formatAddr(addr: number): string {
  return addr.toString(16).toUpperCase().padStart(4, "0");
}

/** Format a byte as 2-digit uppercase hex or ".." for undefined */
function formatByte(b: number | undefined): string {
  return b !== undefined ? b.toString(16).toUpperCase().padStart(2, "0") : "..";
}

/** Format ASCII representation of a byte */
function formatAscii(b: number | undefined): string {
  if (b === undefined) return ".";
  if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
  return ".";
}

/** Output a hex line for a range of bytes */
function formatHexLine(
  map: MemoryMap,
  address: number,
  lineLength: number,
  bytesPerLine: number,
  showAscii: boolean
): string {
  const bytes = map.readBytes(address, lineLength);
  const addrStr = formatAddr(address);

  const hexParts: string[] = [];
  for (let i = 0; i < bytesPerLine; i++) {
    if (i < bytes.length) {
      hexParts.push(formatByte(bytes[i]));
    } else {
      hexParts.push("  ");
    }
  }
  const hexStr = hexParts.join(" ");

  if (showAscii) {
    const asciiStr = bytes.map(formatAscii).join("");
    return `${addrStr}  ${hexStr}  |${asciiStr}|`;
  }
  return `${addrStr}  ${hexStr}`;
}

/** Format labels at an address */
function formatLabels(labels: LabelIndex, address: number): string[] {
  const labelsAtAddr = labels.getLabelsAt(address);
  return labelsAtAddr.map((label) => {
    const addrStr = formatAddr(label.address);
    return `${addrStr} ${label.name}:`;
  });
}

export function hexDump(
  map: MemoryMap,
  start: number,
  length: number,
  options: HexDumpOptions = {}
): string {
  const { bytesPerLine = 16, showAscii = true, showLabels = true } = options;
  const lines: string[] = [];
  const end = start + length;

  // Get labels for this range if showing labels
  const labels = showLabels ? map.getLabels() : null;
  const labelsInRange = labels?.getLabelsInRange(start, end) ?? [];
  const labelAddresses = new Set(labelsInRange.map((l) => l.address));

  let offset = 0;
  while (offset < length) {
    const address = start + offset;
    let lineLength = Math.min(bytesPerLine, length - offset);

    // Check if there's a label within this line that should interrupt it
    if (labels && labelAddresses.size > 0) {
      for (let i = 1; i < lineLength; i++) {
        if (labelAddresses.has(address + i)) {
          // Interrupt the line at this label
          lineLength = i;
          break;
        }
      }

      // Output any labels at the current address
      const labelLines = formatLabels(labels, address);
      lines.push(...labelLines);
    }

    // Output the hex line
    lines.push(formatHexLine(map, address, lineLength, bytesPerLine, showAscii));
    offset += lineLength;
  }

  return lines.join("\n");
}
