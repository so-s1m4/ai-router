import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private socket?: Socket;
  connect(): Socket {
    this.disconnect();
    return (this.socket = io({ path: '/socket.io', transports: ['websocket'] }));
  }
  disconnect() {
    this.socket?.disconnect();
    this.socket = undefined;
  }
}
