import { Server } from '@server/server';
import { ServerStatus } from '@server/enum';
import type { Client } from '@ws/client';
import type { WebSocketData } from '@ws/types';

class ServerManager {
	private servers: Map<string, Server> = new Map();
	private ws!: Bun.Server<WebSocketData>;
	private servers_loop: NodeJS.Timeout;
	
	TICK_RATE = 60;
	TICK_DELTA = 1000 / this.TICK_RATE;

	constructor(ws: Bun.Server<WebSocketData>) {
		this.ws = ws;
		this.servers_loop = setInterval(() => this.tick(this.TICK_DELTA), this.TICK_DELTA);
	}

	private generateUniqueId(): string {
		let id: string;
		do {
			id = Bun.randomUUIDv7();
		} while (this.servers.has(id));
		return id;
	}

	create_server(status: ServerStatus, maxPlayers: number, owner: Client): Server {
		const id = this.generateUniqueId();
		const server = new Server(this.ws, id, status, maxPlayers, owner);
		this.servers.set(id, server);
		return server;
	}

	get_available_servers(): Server[] {
		return Array
				.from(this.servers.values())
				.filter(
					server => server.status === ServerStatus.OPEN
				);
	}

	get_server_by_id(id: string): Server | undefined {
		return this.servers.get(id);
	}

	connect_client_to_server(client: Client, serverId: string): boolean {
		const server = this.servers.get(serverId);
		if (!server) {
			return false;
		}
		return server.add_client(client);
	}

	client_disconnect(clientId: string) {
		for (const server of this.servers.values()) {
			server.remove_client(clientId);
		}
	}

	tick(elapsed_time: number) {
		for (const server of this.servers.values()) {
			server.tick(elapsed_time);
		}
	}

	destroy() {
		clearInterval(this.servers_loop);
		this.servers.clear();
	}
}

export { ServerManager };