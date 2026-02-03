import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        vue(),
        wasm()
    ],
    resolve: {
        alias: {
            '@components': path.resolve(__dirname, 'src/components'),
            '@engine': path.resolve(__dirname, 'src/engine'),
            '@types': path.resolve(__dirname, 'src/@types'),
            '@utils': path.resolve(__dirname, 'src/utils'),
            '@': path.resolve(__dirname, 'src'),
        },
    },
})