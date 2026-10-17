import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** The app's version: the date it was built (or the dev server started), as yymmdd. */
function buildVersion(): string {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getFullYear() % 100)}${two(d.getMonth() + 1)}${two(d.getDate())}`;
}

export default defineConfig({
  root: '.',
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
