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
  /** Events listened to (e.g. "max_say"): subscribed again after every reconnect. */
  private readonly listeners = new Map<string, (data: Record<string, unknown>) => void>();
  /** The subscription ids on the current connection, and which event each is for. */
  private readonly subscribed = new Map<number, string>();
  private retry?: NodeJS.Timeout;

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

  /**
   * Listens for a Home Assistant event (e.g. one an automation fires), for as long as Max runs: the connection is
   * opened again by itself when it drops.
   */
  listen(eventType: string, handler: (data: Record<string, unknown>) => void): void {
    this.listeners.set(eventType, handler);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.subscribe(this.ws, eventType);
    else void this.open().catch(() => this.reconnectLater());
  }

  private subscribe(ws: WebSocket, eventType: string): void {
    const id = this.nextId++;
    this.subscribed.set(id, eventType);
    ws.send(JSON.stringify({ id, type: 'subscribe_events', event_type: eventType }));
  }

  private reconnectLater(): void {
    if (!this.listeners.size || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.open().catch(() => this.reconnectLater());
    }, 15_000);
    this.retry.unref();
  }

  close(): void {
    this.listeners.clear();
    clearTimeout(this.retry);
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
        this.subscribed.clear();
        this.reconnectLater();
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
          for (const type of this.listeners.keys()) this.subscribe(ws, type);
          resolve(ws);
        } else if (msg.type === 'event' && msg.id !== undefined) {
          const type = this.subscribed.get(msg.id);
          const data = (msg as { event?: { data?: Record<string, unknown> } }).event?.data ?? {};
          if (type) this.listeners.get(type)?.(data);
        } else if (msg.type === 'result' && msg.id !== undefined) {
          if (this.subscribed.has(msg.id)) return; // a subscription's own answer
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
