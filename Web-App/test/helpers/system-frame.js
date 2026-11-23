'use strict';
/**
 * Loaded before `require('node:test')`: what the test itself calls (test data via
 * services, services without an account) runs in the system context, i.e.
 * via the system role past row security. HTTP requests leave it
 * (asRequest) and run as in production. The number of these files may only sink
 * (test/roles-separation-db.test.js); a converted file sets the account itself (asRequest).
 */
const Module = /** @type {any} */ (require('node:module'));
const path = require('node:path');

const original = require('node:test');
// Only on call: at load time dist/ may not be built yet.
const inSystemContext = (reason, f) =>
  require(path.join(__dirname, '..', '..', 'dist', 'src', 'infra', 'accountContext.js')).inSystemContext(reason, f);

// The arity stays: by it node:test recognizes a test with a done callback.
const inFrame = f =>
  typeof f === 'function'
    ? Object.defineProperty(
        function (...a) {
          return inSystemContext('Testdaten', () => f.apply(this, a));
        },
        'length',
        { value: f.length },
      )
    : f;
const shell = f => {
  const h = function (...a) {
    return f.apply(this, a.map(inFrame));
  };
  for (const k of ['only', 'skip', 'todo'])
    if (typeof f[k] === 'function') h[k] = (...a) => f[k].apply(f, a.map(inFrame));
  return h;
};

const test = /** @type {any} */ (shell(original));
for (const k of Object.keys(original))
  if (['it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach'].includes(k))
    test[k] = shell(original[k]);
  else if (k === 'test') test.test = test;
  else if (!(k in test)) Object.defineProperty(test, k, { get: () => original[k], enumerable: true });

// TEST_WITHOUT_SYSTEM_FRAME=1 shows which files are already green without the context.
const load = Module._load;
if (process.env.TEST_WITHOUT_SYSTEM_FRAME !== '1')
  Module._load = function (request, ...rest) {
    return request === 'node:test' || request === 'test' ? test : load.call(this, request, ...rest);
  };
