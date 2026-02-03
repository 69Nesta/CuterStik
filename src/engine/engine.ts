import { Scene } from 'three';

import { Debug } from '@engine/debug.ts';
import { Sizes } from '@engine/sizes.ts';
import { Time } from '@engine/time.ts';
import { Camera } from '@engine/render/camera.ts';
import { Renderer } from '@engine/render/renderer.ts';
import { World } from '@engine/world.ts'
import { Physics } from '@engine/physics.ts';
import { Input } from '@engine/input.ts';
import { Player } from './entities/player';


export class Engine {
    static instance: Engine | null = null;
    public canvas!: HTMLCanvasElement;
    public debug!: Debug;
    public sizes!: Sizes;
    public time!: Time;
    public input!: Input;
    public scene!: Scene;
    public world!: World;
    public physics!: Physics;
    public camera!: Camera;
    public renderer!: Renderer;
    public player!: Player;

    public debugObject!: { printCameraCoords?: () => void };

    constructor(_canvas?: HTMLCanvasElement) {
        // Singleton
        if (Engine.instance) return Engine.instance;
        Engine.instance = this;

        if (!_canvas) throw new Error('Canvas is not defined');
        this.canvas = _canvas

        // Setup
        this.debug = new Debug();
        this.sizes = new Sizes();
        this.time = new Time();
        this.input = new Input();
        this.input.start();
        this.scene = new Scene();
        this.physics = new Physics();
        this.world = new World();
        this.camera = new Camera();
        this.player = new Player('Bot', 100);

        // this.raycaster = new Raycaster();


        this.renderer = new Renderer();


        this.sizes.on('resize', this.resize.bind(this));
        this.time.on('tick', this.update.bind(this));


        this.debugObject = {};
        if (this.debug.active) {
            this.debugObject = {
                printCameraCoords: () => this.camera.printCameraCoords()
            }

            this.debug.ui?.add(this.debugObject, 'printCameraCoords');
        }
    }

    resize() {
        this.camera.resize()
        this.renderer.resize()
    }

    update() {
        this.player.update_player(this.input.getMovementDirection())

        this.physics.update(this.time.delta / 1000)

        this.camera.update()
        this.renderer.update()
    }

    destroy() {
        this.sizes.off('resize')
        this.time.off('tick')

        this.renderer.destroy()
        this.world.destroy()
        this.scene.clear()
        this.physics.destroy()
        this.input.stop();

        
        if (this.debug.active) {
            this.debug.ui?.destroy()
        }
        Engine.instance = null;
    }
}
