<script setup lang="ts">
	import { onMounted, onUnmounted } from 'vue';
	import { ThreeSceneService } from '@engine/three_scene_service.ts'

	onMounted(async () => {
		const canvas = document.getElementById('canvas') as HTMLCanvasElement;
		if (!canvas) return;

		await ThreeSceneService.initializeEngine(canvas);
	});

	onUnmounted(async () => {
		ThreeSceneService.destroyEngine();
	})
</script>

<template>
	<canvas id="canvas"></canvas>
</template>

<style scoped>

</style>