export const FRAME_CONTENT_TYPE = "application/vnd.univer.mcp-frame+v1";

export function encodeFrame(
  header: unknown,
  payload: Uint8Array = new Uint8Array(),
): Buffer<ArrayBuffer> {
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([length, json, payload]);
}

export function decodeFrame(bytes: Uint8Array): { header: unknown; payload: Uint8Array } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 4) throw new Error("Truncated RPC frame");
  const length = buffer.readUInt32BE();
  if (length === 0 || length > buffer.length - 4) throw new Error("Truncated RPC header");
  return {
    header: JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(4, 4 + length)),
    ),
    payload: buffer.subarray(4 + length),
  };
}
