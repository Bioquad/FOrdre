// ESLint (configuració plana): regles bàsiques per detectar errors reals.
// Execució: npx eslint js servidor proves sw.js
module.exports = [
    {
        files: ['js/**/*.js', 'sw.js'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'script',
            globals: {
                window: 'readonly', globalThis: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
                localStorage: 'readonly', indexedDB: 'readonly', fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly',
                FileReader: 'readonly', File: 'readonly', Image: 'readonly', EventSource: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
                clearInterval: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
                console: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', CompressionStream: 'readonly', DecompressionStream: 'readonly', Response: 'readonly',
                btoa: 'readonly', atob: 'readonly', self: 'readonly', caches: 'readonly', THREE: 'readonly', XLSX: 'readonly', qrcode: 'readonly', jsQR: 'readonly',
                getComputedStyle: 'readonly', performance: 'readonly', Event: 'readonly', HTMLElement: 'readonly', module: 'writable', require: 'readonly', DOMParser: 'readonly',
                ResizeObserver: 'readonly', matchMedia: 'readonly', devicePixelRatio: 'readonly', crypto: 'readonly', AbortController: 'readonly', structuredClone: 'readonly'
            }
        },
        rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error' }
    },
    {
        files: ['servidor/**/*.js', 'proves/**/*.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'commonjs',
            globals: { require: 'readonly', module: 'writable', process: 'readonly', __dirname: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', URL: 'readonly', global: 'writable', globalThis: 'readonly' }
        },
        rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error' }
    }
];
