/**
 * D64 disk image parser.
 *
 * A standard D64 is 174848 bytes (35 tracks, no error info).
 * Track 18 contains the directory and BAM (Block Availability Map).
 * Directory entries are 32 bytes each, 8 per sector.
 */

const TRACK_OFFSETS: number[] = [];
const SECTORS_PER_TRACK = [
  21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, // 1-17
  19, 19, 19, 19, 19, 19, 19, // 18-24
  18, 18, 18, 18, 18, 18, // 25-30
  17, 17, 17, 17, 17, // 31-35
];

// Pre-compute track offsets
let offset = 0;
for (const sectors of SECTORS_PER_TRACK) {
  TRACK_OFFSETS.push(offset);
  offset += sectors * 256;
}

const DIRECTORY_TRACK = 18;
const DIRECTORY_SECTOR = 1;

export interface D64Entry {
  filename: string;
  type: "del" | "seq" | "prg" | "usr" | "rel" | "unknown";
  locked: boolean;
  closed: boolean;
  track: number;
  sector: number;
  sizeInSectors: number;
}

function getTrackSectorOffset(track: number, sector: number): number {
  if (track < 1 || track > 35) {
    throw new Error(`Invalid track: ${track}`);
  }
  const maxSector = SECTORS_PER_TRACK[track - 1];
  if (sector < 0 || sector >= maxSector) {
    throw new Error(`Invalid sector ${sector} for track ${track}`);
  }
  return TRACK_OFFSETS[track - 1] + sector * 256;
}

function parseFiletype(byte: number): D64Entry["type"] {
  const typeNum = byte & 0x07;
  switch (typeNum) {
    case 0:
      return "del";
    case 1:
      return "seq";
    case 2:
      return "prg";
    case 3:
      return "usr";
    case 4:
      return "rel";
    default:
      return "unknown";
  }
}

function petsciiToAscii(bytes: Uint8Array): string {
  let result = "";
  for (const b of bytes) {
    if (b === 0xa0 || b === 0x00) break; // padding
    // Simple PETSCII to ASCII - lowercase letters are $41-$5A, uppercase $C1-$DA
    if (b >= 0x41 && b <= 0x5a) {
      result += String.fromCharCode(b + 0x20); // to lowercase ASCII
    } else if (b >= 0xc1 && b <= 0xda) {
      result += String.fromCharCode(b - 0x80); // to uppercase ASCII
    } else if (b >= 0x20 && b <= 0x7e) {
      result += String.fromCharCode(b);
    } else {
      result += "?";
    }
  }
  return result;
}

export function listDirectory(image: Uint8Array): D64Entry[] {
  const entries: D64Entry[] = [];

  let track = DIRECTORY_TRACK;
  let sector = DIRECTORY_SECTOR;

  while (track !== 0) {
    const offset = getTrackSectorOffset(track, sector);

    // Each sector has 8 directory entries of 32 bytes each
    // First 2 bytes are link to next directory sector
    const nextTrack = image[offset];
    const nextSector = image[offset + 1];

    for (let i = 0; i < 8; i++) {
      const entryOffset = offset + i * 32;

      // File type byte - 0 means empty/deleted entry
      const fileTypeByte = image[entryOffset + 2];
      if (fileTypeByte === 0) continue;

      const fileTrack = image[entryOffset + 3];
      const fileSector = image[entryOffset + 4];
      const filenameBytes = image.slice(entryOffset + 5, entryOffset + 21);
      const sizeInSectors = image[entryOffset + 30] | (image[entryOffset + 31] << 8);

      entries.push({
        filename: petsciiToAscii(filenameBytes),
        type: parseFiletype(fileTypeByte),
        locked: (fileTypeByte & 0x40) !== 0,
        closed: (fileTypeByte & 0x80) !== 0,
        track: fileTrack,
        sector: fileSector,
        sizeInSectors,
      });
    }

    track = nextTrack;
    sector = nextSector;
  }

  return entries;
}

export function extractFile(image: Uint8Array, entry: D64Entry): Uint8Array {
  const chunks: Uint8Array[] = [];

  let track = entry.track;
  let sector = entry.sector;

  while (track !== 0) {
    const offset = getTrackSectorOffset(track, sector);
    const nextTrack = image[offset];
    const nextSector = image[offset + 1];

    if (nextTrack === 0) {
      // Last sector - nextSector contains number of bytes used
      chunks.push(image.slice(offset + 2, offset + 2 + nextSector));
    } else {
      // Full sector - 254 bytes of data
      chunks.push(image.slice(offset + 2, offset + 256));
    }

    track = nextTrack;
    sector = nextSector;
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
}

export function findFile(image: Uint8Array, name: string): D64Entry | undefined {
  const entries = listDirectory(image);
  const lowerName = name.toLowerCase();
  return entries.find((e) => e.filename.toLowerCase() === lowerName);
}
