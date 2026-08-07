import { defineConfig } from 'vitest/config'

// `api/tests/*.test.ts` são testes de `node:test` (rodam via
// `node --experimental-strip-types --test`), não de vitest — sem este
// escopo, o glob default do vitest tentava rodar os dois arquivos e
// reportava "No test suite found" (falso negativo: os testes já rodavam
// de verdade via node:test, só não eram reconhecidos pelo runner errado).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
