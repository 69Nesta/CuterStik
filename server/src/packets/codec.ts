import { PacketType, PacketSize } from './enums';
import type { InputPacket } from './types';

const INPUT_PACKET_SIZE = PacketSize.TYPE
	+ PacketSize.SEQ
	+ PacketSize.MOVE_X
	+ PacketSize.MOVE_Y
	+ PacketSize.YAW
	+ PacketSize.PITCH;

export function encodeInput(input: InputPacket) {
	const buffer = new ArrayBuffer(INPUT_PACKET_SIZE);
	const view = new DataView(buffer);

	let o = 0;
	view.setUint8(o, PacketType.INPUT); o += PacketSize.TYPE;
	view.setUint32(o, input.seq); o += PacketSize.SEQ;
	view.setInt8(o, input.moveX * 127); o += PacketSize.MOVE_X;
	view.setInt8(o, input.moveY * 127); o += PacketSize.MOVE_Y;
	view.setFloat32(o, input.yaw); o += PacketSize.YAW;
	view.setFloat32(o, input.pitch); o += PacketSize.PITCH;

	return buffer;
}

export function decodeInput(buffer: ArrayBuffer): InputPacket {
	const view = new DataView(buffer);
	let o = PacketSize.TYPE;

	const data: InputPacket = {
		seq: 0,
		moveX: 0,
		moveY: 0,
		yaw: 0,
		pitch: 0,
	};

	data.seq = view.getUint32(o, true);
	o += PacketSize.SEQ;

	data.moveX = view.getInt8(o) / 127;
	o += PacketSize.MOVE_X;

	data.moveY = view.getInt8(o) / 127;
	o += PacketSize.MOVE_Y;

	data.yaw = view.getFloat32(o, true);
	o += PacketSize.YAW;

	data.pitch = view.getFloat32(o, true);
	o += PacketSize.PITCH;
	
	return data;
}
