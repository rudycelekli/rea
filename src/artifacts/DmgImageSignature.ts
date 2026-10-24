import type { FileHandle } from "node:fs/promises";

const KOLY = Buffer.from("koly");
const GPT_HEADER = Buffer.from("EFI PART");

const readExact = async (
  handle: FileHandle,
  position: number,
  length: number,
  abortIfNeeded: () => void,
): Promise<Buffer | undefined> => {
  const buffer = Buffer.alloc(length);
  let readBytes = 0;
  while (readBytes < length) {
    abortIfNeeded();
    const read = await handle.read(
      buffer,
      readBytes,
      length - readBytes,
      position + readBytes,
    );
    abortIfNeeded();
    if (read.bytesRead === 0) return undefined;
    readBytes += read.bytesRead;
  }
  return buffer;
};

/**
 * UDIF images carry a `koly` trailer. An hdiutil UDRW image is a raw GPT disk
 * instead: a protective MBR signature at offset 510 and `EFI PART` at 512.
 * The caller still requires a `.dmg` path; these bytes are not a filename.
 */
export const fileHasDmgImageSignature = async (
  handle: FileHandle,
  size: number,
  abortIfNeeded: () => void,
): Promise<boolean> => {
  if (size >= 512) {
    const trailer = await readExact(handle, size - 512, 4, abortIfNeeded);
    if (trailer?.equals(KOLY) === true) return true;
  }
  if (size < 520) return false;
  const header = await readExact(handle, 510, 10, abortIfNeeded);
  return (
    header !== undefined &&
    header[0] === 0x55 &&
    header[1] === 0xaa &&
    header.subarray(2).equals(GPT_HEADER)
  );
};
