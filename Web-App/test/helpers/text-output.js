'use strict';
/**
 * Preloaded into every test file (scripts/test-run.js, `--require`): text on
 * stdout goes to stderr. node:test reads report frames and text of the child
 * from the same stream; if text with a non-ASCII byte at position 2
 * (“✅ …", “╔══…") follows a frame directly in the same read chunk, the … computes
 */
if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  const raw = process.stdout.write.bind(process.stdout);
  process.stdout.write = /** @type {typeof process.stdout.write} */ (
    (piece, ...rest) => {
      return typeof piece === 'string' ? process.stderr.write(piece, ...rest) : raw(piece, ...rest);
    }
  );
}
