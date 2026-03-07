export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export type GatewayClientOptions = {
  url: string;
  token?: string;
  password?: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onEvent?: (evt: GatewayEventFrame) => void;
};

function generateUUID(): string {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private connectNonce: string | null = null;
  private connectSent = false;
  private backoffMs = 800;
  private isConnected = false;

  constructor(private opts: GatewayClientOptions) {}

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.flushPending(new Error("client stopped"));
  }

  get connected() {
    return this.isConnected;
  }

  private connect() {
    if (this.closed) {
      return;
    }
    this.ws = new WebSocket(this.opts.url);
    this.ws.addEventListener("open", () => this.queueConnect());
    this.ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));
    this.ws.addEventListener("close", () => {
      this.ws = null;
      this.isConnected = false;
      this.flushPending(new Error("gateway closed"));
      this.opts.onDisconnected?.();
      this.scheduleReconnect();
    });
    this.ws.addEventListener("error", () => {});
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    setTimeout(() => this.connect(), delay);
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    setTimeout(() => this.sendConnect(), 750);
  }

  private async sendConnect() {
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "webchat-ui",
        version: "0.1.0",
        platform: navigator.platform ?? "web",
        mode: "webchat",
      },
      role: "operator",
      scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
      caps: [],
      auth:
        this.opts.token || this.opts.password
          ? { token: this.opts.token, password: this.opts.password }
          : undefined,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };

    try {
      await this.request("connect", params);
      this.backoffMs = 800;
      this.isConnected = true;
      this.opts.onConnected?.();
    } catch {
      this.ws?.close(4008, "connect failed");
    }
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const frame = parsed as { type?: unknown };

    if (frame.type === "event") {
      const evt = parsed as GatewayEventFrame;
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: string } | undefined;
        if (payload?.nonce) {
          this.connectNonce = payload.nonce;
          void this.sendConnect();
        }
        return;
      }
      this.opts.onEvent?.(evt);
      return;
    }

    if (frame.type === "res") {
      const res = parsed as GatewayResponseFrame;
      const pending = this.pending.get(res.id);
      if (!pending) {
        return;
      }
      this.pending.delete(res.id);
      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(new Error(res.error?.message ?? "request failed"));
      }
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    const id = generateUUID();
    const frame = { type: "req", id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
    });
    this.ws.send(JSON.stringify(frame));
    return p;
  }
}
