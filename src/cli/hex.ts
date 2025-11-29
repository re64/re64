import { MemoryMap } from "../core/index.js";

export interface HexDumpOptions {
  bytesPerLine?: number;
  showAscii?: boolean;
}

export function hexDump(
  map: MemoryMap,
  start: number,
  length: number,
  options: HexDumpOptions = {}
): string {
  const { bytesPerLine = 16, showAscii = true } = options;
  const lines: string[] = [];

  for (let offset = 0; offset < length; offset += bytesPerLine) {
    const address = start + offset;
    const lineLength = Math.min(bytesPerLine, length - offset);
    const bytes = map.readBytes(address, lineLength);

    const addrStr = address.toString(16).toUpperCase().padStart(4, "0");

    const hexParts: string[] = [];
    for (let i = 0; i < bytesPerLine; i++) {
      if (i < bytes.length) {
        const b = bytes[i];
        hexParts.push(b !== undefined ? b.toString(16).toUpperCase().padStart(2, "0") : "..");
      } else {
        hexParts.push("  ");
      }
    }
    const hexStr = hexParts.join(" ");

    if (showAscii) {
      const asciiParts: string[] = [];
      for (const b of bytes) {
        if (b === undefined) {
          asciiParts.push(".");
        } else if (b >= 0x20 && b <= 0x7e) {
          asciiParts.push(String.fromCharCode(b));
        } else {
          asciiParts.push(".");
        }
      }
      const asciiStr = asciiParts.join("");
      lines.push(`${addrStr}  ${hexStr}  |${asciiStr}|`);
    } else {
      lines.push(`${addrStr}  ${hexStr}`);
    }
  }

  return lines.join("\n");
}
