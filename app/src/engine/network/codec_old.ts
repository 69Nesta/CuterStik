import { PacketType, PacketSize } from './enums_old';
import type { InputPacket, SnapshotEntity } from './types_old';

const INPUT_PACKET_SIZE = PacketSize.TYPE
	+ PacketSize.SEQ
	+ PacketSize.MOVE_X
	+ PacketSize.MOVE_Z
	+ PacketSize.MOVE_Y
	+ PacketSize.YAW
	+ PacketSize.PITCH;

const SNAPSHOT_HEADER_PACKET_SIZE = PacketSize.TYPE
	+ PacketSize.SERVER_TICK
	+ PacketSize.ENTITIES_COUNT
	+ PacketSize.LAST_INPUT_SEQ;

const SNAPSHOT_ENTITY_DATA_SIZE = (entity_count: number) => (
		PacketSize.ENTITY_ID
		+ PacketSize.POSITION
		+ PacketSize.ROTATION
		+ PacketSize.VELOCITY
	) * entity_count;


export function encode_input(input: InputPacket) {
	const buffer = new ArrayBuffer(INPUT_PACKET_SIZE);
	const view = new DataView(buffer);

	let o = 0;
	view.setUint8(o, PacketType.INPUT); o += PacketSize.TYPE;
	view.setUint32(o, input.seq); o += PacketSize.SEQ;
	view.setInt8(o, input.moveX * 127); o += PacketSize.MOVE_X;
	view.setInt8(o, input.moveY * 127); o += PacketSize.MOVE_Y;
	view.setInt8(o, input.moveZ * 127); o += PacketSize.MOVE_Z;
	view.setFloat32(o, input.yaw); o += PacketSize.YAW;
	view.setFloat32(o, input.pitch); o += PacketSize.PITCH;

	return buffer;
}

export const encode_login = (): ArrayBuffer => {
	const buffer = new ArrayBuffer(PacketSize.TYPE);
	const view = new DataView(buffer);
	view.setUint8(0, PacketType.LOGIN);
	return buffer;
}

export const encode_snapshot = (snapshotId: number, players: SnapshotEntity[]): DataView => {
	const buffer = new ArrayBuffer(SNAPSHOT_HEADER_PACKET_SIZE + SNAPSHOT_ENTITY_DATA_SIZE(players.length));
	const view = new DataView(buffer);
	let o = 0;

	view.setUint8(o, PacketType.SNAPSHOT);
	o += PacketSize.TYPE;

	view.setUint32(o, snapshotId, true);
	o += PacketSize.SERVER_TICK;

	view.setUint16(o, players.length, true);
	o += PacketSize.ENTITIES_COUNT;

	view.setUint32(o, 0, true); // placeholder for last input seq
	o += PacketSize.LAST_INPUT_SEQ;

	for (const player of players) {
		view.setUint32(o, player.id, true);
		o += PacketSize.ENTITY_ID;

		view.setFloat32(o, player.position.x, true);
		view.setFloat32(o + 4, player.position.y, true);
		view.setFloat32(o + 8, player.position.z, true);
		o += PacketSize.POSITION;

		view.setFloat32(o, player.rotation.x, true);
		view.setFloat32(o + 4, player.rotation.y, true);
		view.setFloat32(o + 8, player.rotation.z, true);
		view.setFloat32(o + 12, player.rotation.w, true);
		o += PacketSize.ROTATION;

		view.setFloat32(o, player.velocity.x, true);
		view.setFloat32(o + 4, player.velocity.y, true);
		view.setFloat32(o + 8, player.velocity.z, true);
		o += PacketSize.VELOCITY;
	}

	return view;
}

// export const decode_snapshot = (data: ArrayBuffer): { snapshotId: number, players: SnapshotEntity[] } => {

