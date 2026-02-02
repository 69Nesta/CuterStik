import { Engine } from '@engine/engine.ts';
// import RAPIER from '@dimforge/rapier3d';

export let engine: Engine | null = null;
const initializeEngine = async (canvas: HTMLCanvasElement) => {
    // await RAPIER.init();
    engine = new Engine(canvas);
}

const destroyEngine = () => {
    if (!engine) return;
    engine.destroy();
    engine = null;
}

export const ThreeSceneService = {
    initializeEngine: initializeEngine,
    destroyEngine: destroyEngine
}