import { healthBody } from '../health.js';

describe('health check', () => {
  it('reports ok and the commit the image was built from', () => {
    const sha = 'a'.repeat(40);
    expect(healthBody({ COMMIT_SHA: sha })).toEqual({ ok: true, status: 'ok', version: sha });
  });

  it('reports an unknown version when no commit was baked in', () => {
    expect(healthBody({})).toEqual({ ok: true, status: 'ok', version: 'unknown' });
  });
});
