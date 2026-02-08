import type { Client } from '@ws/client';
import type { ServerStatus } from '@server/enum';
import { Game } from '@game/game'
import type { WebSocketData } from '@ws/types';


class Server {
	public ws: Bun.Server<WebSocketData>;
	public id: string;
	public status: ServerStatus;
	public max_players: number;
	public current_players: number;
	public clients: Client[] = [];
	public game: Game;
	public room: string = '';

	constructor(ws: Bun.Server<WebSocketData>, id: string, status: ServerStatus, max_players: number, owner: Client) {
		this.ws = ws;
		this.id = id;
		this.max_players = max_players;
		this.current_players = 1; // Owner is the first player
		this.status = status;
		this.add_client(owner);
		this.room = `game-${id}`;
		this.game = new Game(this);
	}

	add_client(client: Client): boolean {
		if (this.current_players >= this.max_players) {
			return false; // Server is full
		}
		this.clients.push(client);
		this.current_players++;
		client.ws.subscribe(this.room);
		return true;
	}

	remove_client(clientId: string) {
		const client = this.clients.find(c => c.id === clientId);
		if (!client) {
			return; // Client not found
		}
		client.ws.unsubscribe(this.room);		
		this.clients = this.clients.filter(c => c.id !== clientId);
		this.current_players = this.clients.length;
	}

	tick(elapsed_time: number) {
		this.game.tick(elapsed_time);
	}
}

export { Server }