import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['tests/**/*.test.ts','tests/**/*.test.tsx','src/vendor/**/*.test.ts','src/vendor/**/*.test.tsx'],maxWorkers:1,fileParallelism:false}});
