import { it, expect } from 'bun:test';
// Route mocks must be isolated from other route suites' module registry.
it('SCORM library authorization and course listing regressions', () => {
 const run = Bun.spawnSync([process.execPath, 'test', './src/lib/__tests__/scorm-library.fixture.ts'], { stdout: 'pipe', stderr: 'pipe' });
 if (run.exitCode !== 0) console.error(new TextDecoder().decode(run.stderr));
 expect(run.exitCode).toBe(0);
});
