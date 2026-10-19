/**
 * A small client for Home Assistant's websocket API (the one its own screens use): sign in with a token,
 * then send commands and get their results. Reconnects by itself on the next command if the connection
 * dropped (e.g. Home Assistant restarted).
 */
export class HaSocket {
  private ws?: WebSocket;
  private opening?: Promise<WebSocket>;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string,
  ) {}

  /** Sends one command (e.g. "config/device_registry/list") and returns its result. */
  async call<T = unknown>(type: string, payload: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
    const ws = await this.open();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Home Assistant didn't answer "${type}" in time`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ id, type, ...payload }));
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }

  private open(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.baseUrl.replace(/^http/, 'ws') + '/api/websocket');
      const fail = (msg: string) => {
        this.opening = undefined;
        reject(new Error(msg));
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      };
      const guard = setTimeout(() => fail("Home Assistant didn't answer"), 15_000);
      ws.onerror = () => fail("Can't reach Home Assistant");
      ws.onclose = () => {
        if (this.ws === ws) this.ws = undefined;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('The connection to Home Assistant closed'));
          this.pending.delete(id);
        }
      };
      ws.onmessage = (e) => {
        let msg: { type?: string; id?: number; success?: boolean; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: this.token() }));
        else if (msg.type === 'auth_invalid') {
          clearTimeout(guard);
          fail('Home Assistant refused the sign-in');
        } else if (msg.type === 'auth_ok') {
          clearTimeout(guard);
          this.ws = ws;
          this.opening = undefined;
          resolve(ws);
        } else if (msg.type === 'result' && msg.id !== undefined) {
          const p = this.pending.get(msg.id);
          if (!p) return;
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          if (msg.success) p.resolve(msg.result);
          else p.reject(new Error(msg.error?.message || 'Home Assistant said no'));
        }
      };
    });
    return this.opening;
  }
}
