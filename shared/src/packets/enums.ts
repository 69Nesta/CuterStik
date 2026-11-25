export enum PacketType {
	INPUT = 1,
	SNAPSHOT = 2,
	PING = 3,
	PONG = 4,
	STATUS = 5,
	MATCH_MAKING = 6,
	MATCH_FOUND = 7,
	// TEMP
	LOGIN = 8,
	JOIN = 9,
	LEAVE = 10,
}

export enum PacketSize {
	TYPE = 1,
	SEQ = 4,
	MOVE_X = 1,
	MOVE_Y = 1,
	MOVE_Z = 1,
	YAW = 4,
	PITCH = 4,
	SERVER_TICK = 4,
	ENTITIES_COUNT = 2,
	ENTITY_ID = 4,
	POSITION = 12, // 3 * float32
	ROTATION = 16, // quaternion, 4 * float32
	VELOCITY = 12, // 3 * float32
	LAST_INPUT_SEQ = 4,
}