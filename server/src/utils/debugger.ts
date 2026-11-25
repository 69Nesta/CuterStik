import Bun from "bun";

class Debugger {
	public name: string;
	public color: string;
	private colors = {
		reset: '\x1b[0m',
		info: Bun.color("cyan", 'ansi')!,
		error: Bun.color("red", 'ansi')!,
		warn: Bun.color("yellow", 'ansi')!,
		debug: Bun.color("gray", 'ansi')!,
	};

	constructor(name: string = 'Main', color: string) {
		this.name = name;
		this.color = Bun.color(color, 'ansi')!;
		this.log('Debugger initialized');
	}

	private timestamp(): string {
		const d = new Date();
		return d.toISOString();
	}

	private format(level: string, message: string, color: string) {
		return `${color}[${level.toUpperCase()}] [${this.color}${this.name}${color}] ${message}${this.colors.reset}`;
	}

	log(message: string) {
		console.log(this.format('debug', message, this.colors.debug));
	}

	error(message: string) {
		console.error(this.format('error', message, this.colors.error));
	}

	warn(message: string) {
		console.warn(this.format('warn', message, this.colors.warn));
	}
}

export { Debugger };