import EventEmitter from '@utils/event_emitter.ts';

export class Sizes extends EventEmitter
{
    public width: number;
    public height: number
    public pixelRatio: number;
    constructor()
    {
        super()
        // Setup
        this.width = window.innerWidth
        this.height = window.innerHeight
        this.pixelRatio = this.get_pixel_ratio()

        // Resize Event
        window.addEventListener('resize', () => {
            this.width = window.innerWidth
            this.height = window.innerHeight
            this.pixelRatio = this.get_pixel_ratio()

            this.trigger('resize')
        })
    }

	get_pixel_ratio(): number {
		return Math.min(window.devicePixelRatio, 2)
	}
}