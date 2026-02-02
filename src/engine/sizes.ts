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
        this.pixelRatio = Math.min(window.devicePixelRatio, 1)

        // Resize Event
        window.addEventListener('resize', () => {
            this.width = window.innerWidth
            this.height = window.innerHeight
            this.pixelRatio = Math.min(window.devicePixelRatio, 1)

            this.trigger('resize')
        })
    }
}