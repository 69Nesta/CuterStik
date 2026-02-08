class Debbuger {
	public name: string;
	private colors = {
		reset: "\x1b[0m",
		info: "\x1b[36m", // cyan
		error: "\x1b[31m", // red
		warn: "\x1b[33m", // yellow
		debug: "\x1b[35m", // magenta
	};

	constructor(name: string = 'Main') {
		this.name = name;
		this.log('Debbuger initialized');
	}

	private timestamp(): string {
		const d = new Date();
		return d.toISOString();
	}

	private format(level: string, message: string, color: string) {
		return `${color}${this.timestamp()} [${this.name}] [${level.toUpperCase()}] ${message}${this.colors.reset}`;
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

export { Debbuger };