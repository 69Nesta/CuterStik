// Simple keyboard input helper
// Supports WASD and ZQSD (AZERTY) layouts and arrow keys.

export class Input {
    private keys: Set<string> = new Set()
    private _down = (e: KeyboardEvent) => {
        this.keys.add(e.key.toLowerCase())
    }
    private _up = (e: KeyboardEvent) => {
        this.keys.delete(e.key.toLowerCase())
    }

    start() {
        window.addEventListener('keydown', this._down)
        window.addEventListener('keyup', this._up)
    }

    stop() {
        window.removeEventListener('keydown', this._down)
        window.removeEventListener('keyup', this._up)
        this.keys.clear()
    }

    // returns a normalized movement direction on the X (left/right) and Z (forward/back) plane
    // forward keys: W or Z or ArrowUp -> positive Z (matches existing impulse in world)
    getMovementDirection(): { x: number; y: number; z: number } {
        let x = 0
		let y = 0
        let z = 0

        if (this.keys.has('w') || this.keys.has('z') || this.keys.has('arrowup')) z += 1
        if (this.keys.has('s') || this.keys.has('arrowdown')) z -= 1

		// left should be negative X, right positive X
		if (this.keys.has('a') || this.keys.has('q') || this.keys.has('arrowleft')) x += 1
		if (this.keys.has('d') || this.keys.has('arrowright')) x -= 1

		if (this.keys.has(' ')) y += 1

        const len = Math.hypot(x, z)
        if (len > 0) {
            x /= len
            z /= len
        }

        return { x, y, z }
    }
}
