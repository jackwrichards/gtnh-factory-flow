"use client";

const PLAN_METADATA_KEY = "gtnh-factory-flow-project";
export const FLOW_IMAGE_EXPORT_EVENT = "gtnh-flow-export-image";
export const FLOW_IMAGE_EXPORT_COMPLETE_EVENT = "gtnh-flow-export-image-complete";

/**
 * What the board is asked for over FLOW_IMAGE_EXPORT_EVENT.
 *
 * The classic shape downloads a finished file: `fileName` plus `projectJson`
 * to embed. `capture: true` instead hands the raw render back through the
 * complete event, so the export dialog can composite a summary bar, swap the
 * background, or animate it — the board only knows how to photograph itself.
 */
export interface FlowExportRequest {
  format: "svg" | "png";
  requestId: string;
  /** Download name, without extension. Required unless capturing. */
  fileName?: string;
  /** The plan to embed in the file. Required unless capturing. */
  projectJson?: string;
  /** Return the render instead of downloading it. */
  capture?: boolean;
  /** Override the board theme's paper: a CSS colour, or "transparent". */
  background?: string;
  /**
   * The look each card wears for the photograph, independent of how far the
   * screen happens to be zoomed. "full" is the whole card; the rest are the
   * board's own smart views at their zoomed-out step: "glance" the big
   * machine icon, "status" speed colours, "usage" reason colours, "power"
   * tier colours.
   */
  cardDetail?: "full" | "glance" | "status" | "usage" | "power";
  /**
   * Leave the notes, arrows and backdrops out of the photograph - only the
   * working board. The frame tightens to the remaining cards too, so a
   * hidden backdrop does not leave its empty acreage behind.
   */
  hideAnnotations?: boolean;
}

/** One line's marching dashes, as replayable data for the GIF export. */
export interface EdgePulseFrameSpec {
  path: string;
  width: number;
  dash: number;
  gap: number;
  velocity: number;
  phase: number;
}

export interface ExportOcclusionDot {
  x: number;
  y: number;
  r: number;
}

/** A raw board render, in the complete event's `capture` field. */
export interface FlowExportCapture {
  kind: "svg" | "png";
  /** PNG captures: the rendered image. */
  blob?: Blob;
  /** SVG captures: the full <svg> document text, no plan metadata yet. */
  svgText?: string;
  /** CSS size of the render; the PNG's pixel size is this times pixelRatio. */
  width: number;
  height: number;
  pixelRatio: number;
  /** The export framing: screen = flow × zoom + (x, y), in CSS px. */
  viewport: { x: number; y: number; zoom: number };
  /** The colour behind the board, or undefined for transparent. */
  background?: string;
  /**
   * Everything a dash overlay must be punched out of, photographed WITH the
   * board (the live registries only describe edges that are mounted, and the
   * capture renders the whole plan): card rectangles when wires dive under
   * cards, rate-chip boxes, waypoint dots. Flow coordinates.
   */
  occlusionRects: Array<{ left: number; top: number; right: number; bottom: number }>;
  occlusionDots: ExportOcclusionDot[];
  /** Every line's dashes at the moment of capture, for the GIF. */
  pulses: EdgePulseFrameSpec[];
}
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PIXEL_PAYLOAD_MAGIC = "GTNHPLAN";
const PIXEL_PAYLOAD_HEADER_BYTES = PIXEL_PAYLOAD_MAGIC.length + 9;
const PIXEL_PAYLOAD_GZIP_FLAG = 1;
const MAX_DISCORD_IMAGE_SIDE = 4096;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function embedProjectJsonInSvg(svgText: string, projectJson: string): string {
  const metadata = `<metadata id="${PLAN_METADATA_KEY}">${encodeText(projectJson)}</metadata>`;
  return svgText.replace(/<svg\b[^>]*>/, (openingTag) => `${openingTag}${metadata}`);
}

export function extractProjectJsonFromSvg(svgText: string): string | undefined {
  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const metadata = document.querySelector(`metadata#${cssEscape(PLAN_METADATA_KEY)}`);
  const encodedProject = metadata?.textContent?.trim();
  return encodedProject ? decodeText(encodedProject) : undefined;
}

export async function embedProjectJsonInPng(
  pngBlob: Blob,
  projectJson: string,
  backgroundColor?: string,
): Promise<Blob> {
  const pngWithPixelPayload = await embedProjectJsonInPngPixels(
    pngBlob,
    projectJson,
    backgroundColor,
  );
  const bytes = new Uint8Array(await pngWithPixelPayload.arrayBuffer());
  validatePng(bytes);

  const iendOffset = findPngChunkOffset(bytes, "IEND");
  const textPayload = concatBytes(
    TEXT_ENCODER.encode(PLAN_METADATA_KEY),
    new Uint8Array([0]),
    TEXT_ENCODER.encode(encodeText(projectJson)),
  );
  const textChunk = createPngChunk("tEXt", textPayload);

  return new Blob(
    [
      toArrayBuffer(bytes.slice(0, iendOffset)),
      toArrayBuffer(textChunk),
      toArrayBuffer(bytes.slice(iendOffset)),
    ],
    {
      type: "image/png",
    },
  );
}

export async function extractProjectJsonFromPng(file: Blob): Promise<string | undefined> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  validatePng(bytes);

  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > bytes.length) {
      throw new Error("Invalid PNG chunk.");
    }

    if (type === "tEXt") {
      const separatorIndex = bytes.indexOf(0, dataStart);
      if (separatorIndex > dataStart && separatorIndex < dataEnd) {
        const keyword = TEXT_DECODER.decode(bytes.slice(dataStart, separatorIndex));
        if (keyword === PLAN_METADATA_KEY) {
          return decodeText(TEXT_DECODER.decode(bytes.slice(separatorIndex + 1, dataEnd)));
        }
      }
    }

    if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  return extractProjectJsonFromPngPixels(file);
}

export function dataUrlToText(dataUrl: string): string {
  const [header, payload] = dataUrl.split(",", 2);
  if (!header || payload === undefined) {
    throw new Error("Invalid image data URL.");
  }

  if (header.endsWith(";base64")) {
    return decodeText(payload);
  }

  return decodeURIComponent(payload);
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

function encodeText(value: string): string {
  const bytes = TEXT_ENCODER.encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeText(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return TEXT_DECODER.decode(bytes);
}

async function embedProjectJsonInPngPixels(
  pngBlob: Blob,
  projectJson: string,
  backgroundColor?: string,
): Promise<Blob> {
  const image = await createImageBitmap(pngBlob);
  const payload = await createPixelPayload(projectJson);
  const stripHeight = Math.ceil(payload.length / (image.width * 3));
  if (stripHeight >= MAX_DISCORD_IMAGE_SIDE) {
    image.close();
    return pngBlob;
  }
  const canvas = document.createElement("canvas");
  const outputHeight = Math.min(MAX_DISCORD_IMAGE_SIDE, image.height + stripHeight);
  const availableImageHeight = outputHeight - stripHeight;
  const imageScale = Math.min(1, availableImageHeight / image.height);
  const imageWidth = Math.round(image.width * imageScale);
  const imageHeight = Math.round(image.height * imageScale);
  const imageX = Math.floor((image.width - imageWidth) / 2);

  canvas.width = image.width;
  canvas.height = outputHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    image.close();
    return pngBlob;
  }

  // The exported image's own paper colour, so the data strip and any
  // letterboxing blend in instead of stamping a light-mode band onto a dark
  // board. No colour means a transparent export: leave the letterbox clear.
  if (backgroundColor) {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, imageX, 0, imageWidth, imageHeight);
  image.close();

  const stripY = canvas.height - stripHeight;
  const imageData = context.createImageData(canvas.width, stripHeight);
  for (let index = 0; index < payload.length; index += 1) {
    const pixelIndex = Math.floor(index / 3) * 4;
    imageData.data[pixelIndex + (index % 3)] = payload[index];
    imageData.data[pixelIndex + 3] = 255;
  }
  for (let index = Math.ceil(payload.length / 3) * 4; index < imageData.data.length; index += 4) {
    imageData.data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, stripY);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? pngBlob), "image/png");
  });
}

async function createPixelPayload(projectJson: string): Promise<Uint8Array> {
  const jsonBytes = TEXT_ENCODER.encode(projectJson);
  const compressedBytes = await gzipBytes(jsonBytes);
  const payloadBytes = compressedBytes ?? jsonBytes;
  const flags = compressedBytes ? PIXEL_PAYLOAD_GZIP_FLAG : 0;
  const header = new Uint8Array(PIXEL_PAYLOAD_HEADER_BYTES);

  header.set(TEXT_ENCODER.encode(PIXEL_PAYLOAD_MAGIC), 0);
  header[PIXEL_PAYLOAD_MAGIC.length] = flags;
  writeUint32(header, PIXEL_PAYLOAD_MAGIC.length + 1, payloadBytes.length);
  writeUint32(header, PIXEL_PAYLOAD_MAGIC.length + 5, crc32(payloadBytes));

  return concatBytes(header, payloadBytes);
}

async function extractProjectJsonFromPngPixels(file: Blob): Promise<string | undefined> {
  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    image.close();
    return undefined;
  }

  context.drawImage(image, 0, 0);
  image.close();

  const scanHeight = canvas.height;
  const imageData = context.getImageData(0, canvas.height - scanHeight, canvas.width, scanHeight);
  const rgbBytes = rgbBytesFromImageData(imageData.data);
  const magicBytes = TEXT_ENCODER.encode(PIXEL_PAYLOAD_MAGIC);
  const payloadOffset = findByteSequence(rgbBytes, magicBytes);
  if (payloadOffset < 0) {
    return undefined;
  }

  const headerEnd = payloadOffset + PIXEL_PAYLOAD_HEADER_BYTES;
  if (headerEnd > rgbBytes.length) {
    return undefined;
  }

  const flags = rgbBytes[payloadOffset + PIXEL_PAYLOAD_MAGIC.length];
  const payloadLength = readUint32(rgbBytes, payloadOffset + PIXEL_PAYLOAD_MAGIC.length + 1);
  const expectedCrc = readUint32(rgbBytes, payloadOffset + PIXEL_PAYLOAD_MAGIC.length + 5);
  const payloadEnd = headerEnd + payloadLength;
  if (payloadLength <= 0 || payloadEnd > rgbBytes.length) {
    return undefined;
  }

  const payloadBytes = rgbBytes.slice(headerEnd, payloadEnd);
  if (crc32(payloadBytes) !== expectedCrc) {
    return undefined;
  }

  const jsonBytes =
    flags & PIXEL_PAYLOAD_GZIP_FLAG ? await gunzipBytes(payloadBytes) : payloadBytes;
  return TEXT_DECODER.decode(jsonBytes);
}

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream === "undefined") {
    return undefined;
  }

  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress the embedded PNG plan.");
  }

  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function rgbBytesFromImageData(data: Uint8ClampedArray): Uint8Array {
  const bytes = new Uint8Array((data.length / 4) * 3);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < data.length; sourceIndex += 4) {
    bytes[targetIndex] = data[sourceIndex];
    bytes[targetIndex + 1] = data[sourceIndex + 1];
    bytes[targetIndex + 2] = data[sourceIndex + 2];
    targetIndex += 3;
  }
  return bytes;
}

function findByteSequence(bytes: Uint8Array, sequence: Uint8Array): number {
  for (let offset = 0; offset <= bytes.length - sequence.length; offset += 1) {
    let matches = true;
    for (let index = 0; index < sequence.length; index += 1) {
      if (bytes[offset + index] !== sequence[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return offset;
    }
  }
  return -1;
}

function validatePng(bytes: Uint8Array) {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error("Invalid PNG file.");
  }
}

function findPngChunkOffset(bytes: Uint8Array, chunkType: string): number {
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error("Invalid PNG chunk.");
    }

    if (type === chunkType) {
      return offset;
    }

    offset = dataEnd + 4;
  }

  throw new Error(`PNG chunk ${chunkType} not found.`);
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = TEXT_ENCODER.encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concatBytes(typeBytes, data)));
  return chunk;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((total, array) => total + array.length, 0));
  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });
  return result;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
