import { Socket, createConnection } from 'node:net';
import { EventEmitter } from 'node:events';

/**
 * Minimal client for the Wyoming protocol used by Home Assistant's voice services
 * (openWakeWord, Whisper, Piper). Each event is a JSON header line, optionally followed
 * by extra JSON data (data_length bytes) and a binary payload (payload_length bytes).
 * Spec: https://github.com/OHF-Voice/wyoming
 */
export interface WyomingEvent {
  type: string;
  data: Record<string, unknown>;
  payload?: Buffer;
}

export class WyomingClient extends EventEmitter {
  private socket?: Socket;
  private buffer = Buffer.alloc(0);
  private pending?: { header: any; need: number };

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {
    super();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port }, () => resolve());
      socket.setNoDelay(true);
      socket.on('data', (chunk) => this.onData(chunk));
      socket.on('error', (err) => {
        // Before connect, the rejected promise reports it; an unheard 'error' would crash Node.
        if (this.listenerCount('error')) this.emit('error', err);
        reject(err);
      });
      socket.on('close', () => this.emit('close'));
      this.socket = socket;
    });
  }

  send(type: string, data: Record<string, unknown> = {}, payload?: Buffer): void {
    if (!this.socket) throw new Error('Wyoming client not connected');
    const dataBuf = Buffer.from(JSON.stringify(data), 'utf8');
    const header: Record<string, unknown> = { type, version: '1.5.0', data_length: dataBuf.length };
    if (payload) header.payload_length = payload.length;
    this.socket.write(JSON.stringify(header) + '\n');
    this.socket.write(dataBuf);
    if (payload) this.socket.write(payload);
  }

  /** Sends `describe` and resolves with the service's `info` (lists installed models etc.). */
  describe(timeoutMs = 3000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('describe timed out')), timeoutMs);
      const onEvent = (e: WyomingEvent) => {
        if (e.type !== 'info') return;
        clearTimeout(timer);
        this.off('event', onEvent);
        resolve(e.data);
      };
      this.on('event', onEvent);
      this.send('describe');
    });
  }

  close(): void {
    this.socket?.end();
    this.socket = undefined;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (!this.pending) {
        const nl = this.buffer.indexOf(0x0a);
        if (nl < 0) return;
        const header = JSON.parse(this.buffer.subarray(0, nl).toString('utf8'));
        this.buffer = this.buffer.subarray(nl + 1);
        const need = (header.data_length ?? 0) + (header.payload_length ?? 0);
        this.pending = { header, need };
      }
      const { header, need } = this.pending;
      if (this.buffer.length < need) return;
      const dataLen = header.data_length ?? 0;
      const extra = dataLen ? JSON.parse(this.buffer.subarray(0, dataLen).toString('utf8')) : {};
      const payload = header.payload_length
        ? Buffer.from(this.buffer.subarray(dataLen, need))
        : undefined;
      this.buffer = this.buffer.subarray(need);
      this.pending = undefined;
      this.emit('event', { type: header.type, data: { ...(header.data ?? {}), ...extra }, payload });
    }
  }
}
