/**
 * Health check payload. `version` is the git commit the image was built from,
 * baked in at deploy time with --build-arg COMMIT_SHA, so a deploy can verify
 * that the shipped commit is the one serving traffic.
 */
export function healthBody(env: NodeJS.ProcessEnv = process.env) {
  return { ok: true, status: 'ok', version: env.COMMIT_SHA || 'unknown' };
}
