export enum PacketType {
	INPUT = 1,
	SNAPSHOT = 2,
	PING = 3,
	PONG = 4
}

export enum PacketSize {
	TYPE = 1,
	SEQ = 4,
	MOVE_X = 1,
	MOVE_Y = 1,
	YAW = 4,
	PITCH = 4,
}