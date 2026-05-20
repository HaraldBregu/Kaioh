import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import type { GatewayConfig } from "../config/schema.js";
import type { CronService } from "../cron/service.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { acceptWebSocket } from "./websocket.js";

const MessageRequestSchema = z.object({
  text: z.string().min(1),
  conversationId: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ScheduleRequestSchema = z.object({
  schedule: z.string().min(1),
  message: z.string().min(1),
  conversationId: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const WebSocketMessageSchema = z.object({
  type: z.literal("agent.message"),
  agentId: z.string().default("default"),
  text: z.string().min(1),
  conversationId: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export class GatewayServer {
  private server: http.Server;

  constructor(
    private config: GatewayConfig,
    private runtime: AgentRuntime,
    private cron: CronService,
  ) {
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    this.server.on("upgrade", (req, socket) => {
      void this.handleUpgrade(req, socket as import("node:net").Socket);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  address(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = this.requestUrl(req);
      if (url.pathname === "/api/health" && req.method === "GET") {
        return this.sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
      }

      if (!this.authorized(req, url)) {
        return this.sendJson(res, 401, { error: "unauthorized" });
      }

      const messageMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/messages$/);
      if (messageMatch && req.method === "POST") {
        const body = MessageRequestSchema.parse(await this.readJson(req));
        const agentId = decodeURIComponent(messageMatch[1]);
        const event = this.runtime.makeEvent({
          agentId,
          source: "http",
          text: body.text,
          conversationId: body.conversationId ?? "http:default",
          userId: body.userId,
          metadata: body.metadata,
        });
        const response = await this.runtime.handleEvent(event);
        return this.sendJson(res, 200, response);
      }

      const sessionMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/sessions\/([^/]+)$/);
      if (sessionMatch && req.method === "GET") {
        const agentId = decodeURIComponent(sessionMatch[1]);
        const sessionId = decodeURIComponent(sessionMatch[2]);
        return this.sendJson(res, 200, { session: await this.runtime.readSession(agentId, sessionId) });
      }

      const workspaceListMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/workspace\/files$/);
      if (workspaceListMatch && req.method === "GET") {
        const agentId = decodeURIComponent(workspaceListMatch[1]);
        const requestedPath = url.searchParams.get("path") ?? ".";
        return this.sendJson(res, 200, {
          path: requestedPath,
          files: await this.runtime.listWorkspace(agentId, requestedPath),
        });
      }

      const workspaceFileMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/workspace\/files\/(.+)$/);
      if (workspaceFileMatch && req.method === "GET") {
        const agentId = decodeURIComponent(workspaceFileMatch[1]);
        const requestedPath = decodeURIComponent(workspaceFileMatch[2]);
        return this.sendJson(res, 200, {
          path: requestedPath,
          content: await this.runtime.readWorkspaceFile(agentId, requestedPath),
        });
      }

      const scheduleCollectionMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/schedules$/);
      if (scheduleCollectionMatch && req.method === "POST") {
        const agentId = decodeURIComponent(scheduleCollectionMatch[1]);
        const body = ScheduleRequestSchema.parse(await this.readJson(req));
        const job = await this.cron.add({
          agentId,
          conversationId: body.conversationId,
          userId: body.userId,
          schedule: body.schedule,
          message: body.message,
          metadata: body.metadata,
        });
        return this.sendJson(res, 201, { job });
      }
      if (scheduleCollectionMatch && req.method === "GET") {
        const agentId = decodeURIComponent(scheduleCollectionMatch[1]);
        return this.sendJson(res, 200, { jobs: this.cron.listJobs(agentId) });
      }

      const scheduleMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/schedules\/([^/]+)$/);
      if (scheduleMatch && req.method === "DELETE") {
        const agentId = decodeURIComponent(scheduleMatch[1]);
        const scheduleId = decodeURIComponent(scheduleMatch[2]);
        const removed = await this.cron.remove(scheduleId, agentId);
        return this.sendJson(res, removed ? 200 : 404, { removed });
      }

      return this.sendJson(res, 404, { error: "not_found" });
    } catch (e) {
      const status = e instanceof z.ZodError ? 400 : 500;
      return this.sendJson(res, status, { error: (e as Error).message });
    }
  }

  private async handleUpgrade(req: IncomingMessage, socket: import("node:net").Socket): Promise<void> {
    try {
      const url = this.requestUrl(req);
      if (url.pathname !== "/api/ws" && url.pathname !== "/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      if (!this.authorized(req, url)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const connection = acceptWebSocket(req, socket);
      connection.send("gateway.ready", { connectionId: connection.id });
      connection.onMessage = async (raw) => {
        try {
          const message = WebSocketMessageSchema.parse(JSON.parse(raw));
          const event = this.runtime.makeEvent({
            agentId: message.agentId,
            source: "websocket",
            text: message.text,
            conversationId: message.conversationId ?? `websocket:${connection.id}`,
            userId: message.userId,
            metadata: message.metadata,
          });
          const response = await this.runtime.handleEvent(event, {
            callbacks: {
              onToolCallStart: (data) => {
                connection.send("agent.tool_call", {
                  eventId: event.id,
                  id: data.id,
                  name: data.name,
                  args: data.args,
                });
              },
              onToolCallResult: (record) => {
                connection.send("agent.tool_result", { eventId: event.id, record });
              },
            },
          });
          connection.send("agent.response", { response });
        } catch (e) {
          connection.send("agent.error", { error: (e as Error).message });
        }
      };
    } catch {
      socket.destroy();
    }
  }

  private authorized(req: IncomingMessage, url: URL): boolean {
    const expected = process.env[this.config.auth_token_env];
    if (!expected) {
      return this.config.allow_unauthenticated_localhost && this.isLocal(req);
    }

    const auth = req.headers.authorization;
    const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    const queryToken = url.searchParams.get("token") ?? "";
    return bearer === expected || queryToken === expected;
  }

  private isLocal(req: IncomingMessage): boolean {
    const address = req.socket.remoteAddress;
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  }

  private requestUrl(req: IncomingMessage): URL {
    return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  }

  private async readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (Buffer.concat(chunks).length > 1024 * 1024) {
        throw new Error("Request body too large.");
      }
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
  }
}
