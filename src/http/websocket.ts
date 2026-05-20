import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 1024 * 1024;

export class WebSocketConnection {
  readonly id = randomUUID();
  private buffer = Buffer.alloc(0);
  private socket: Socket;
  onMessage?: (message: string) => void | Promise<void>;
  onClose?: () => void;

  constructor(socket: Socket) {
    this.socket = socket;
    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("close", () => this.onClose?.());
  }

  send(type: string, payload: Record<string, unknown> = {}): void {
    this.sendRaw(JSON.stringify({ type, ...payload }));
  }

  close(): void {
    this.sendFrame(Buffer.alloc(0), 0x8);
    this.socket.end();
  }

  private sendRaw(payload: string): void {
    this.sendFrame(Buffer.from(payload, "utf8"), 0x1);
  }

  private sendFrame(payload: Buffer, opcode: number): void {
    const length = payload.length;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, payload]));
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const bigLength = this.buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(MAX_FRAME_BYTES)) {
          this.close();
          return;
        }
        length = Number(bigLength);
        offset += 8;
      }

      const maskLength = masked ? 4 : 0;
      if (length > MAX_FRAME_BYTES) {
        this.close();
        return;
      }
      if (this.buffer.length < offset + maskLength + length) return;

      const mask = masked ? this.buffer.subarray(offset, offset + 4) : undefined;
      offset += maskLength;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);

      if (mask) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i % 4];
        }
      }

      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        this.sendFrame(payload, 0xA);
        continue;
      }
      if (opcode === 0x1) {
        void this.onMessage?.(payload.toString("utf8"));
      }
    }
  }
}

export function acceptWebSocket(req: IncomingMessage, socket: Socket): WebSocketConnection {
  const key = req.headers["sec-websocket-key"];
  if (!key || Array.isArray(key)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    throw new Error("Missing WebSocket key.");
  }

  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );

  return new WebSocketConnection(socket);
}

