import Bun from 'bun'
import { Client } from '@ws/client.ts';

export type WebSocketData = {
	client?: Client;
};

export type t_ws = Bun.ServerWebSocket<WebSocketData>;
