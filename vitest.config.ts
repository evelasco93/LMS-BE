import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'cdk.out/',
        '**/*.config.ts',
        '**/*.d.ts',
        '**/types/**',
        'handlers/**/tests/**',
      ],
    },
    include: [],
    exclude: [
      'node_modules/**',
      '**/node_modules/**',
      'dist/**',
      'cdk.out/**',
      'handlers/**',
      '**/*.d.ts',
    ],
  },
  resolve: {
    alias: {
      '@cdk': path.resolve(__dirname, './cdk'),
      '@handlers': path.resolve(__dirname, './handlers'),
      '@utils': path.resolve(__dirname, './utils'),
    },
  },
});
