// import type { PlayerId } from "@/types/ids";

type InputPacket = {
	seq: number;
	moveX: number;
	moveY: number;
	moveZ: number;
	yaw: number;
	pitch: number;
};

type SnapshotEntity = {
	id: number,
	position: { x: number, y: number, z: number },
	rotation: { x: number, y: number, z: number, w: number },
	velocity: { x: number, y: number, z: number }
}


export type { InputPacket, SnapshotEntity }