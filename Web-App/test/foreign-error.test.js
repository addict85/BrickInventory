/**
 * Counter-check: fromUs() in public/js/error-capture.js always returns true → red “an extension triggers no error with us”.
 * Counter-check: the fromUs() check removed from the error listener, and in a second run from the
 * rejection listener → red “both listeners go through the check” each time.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const QUELLE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'error-capture.js'), 'utf8');

/**
 * The safety net only catches OUR errors.
 */

/** Take `fromUs` literally from fehlerfang.js and run it with a provided origin. */
function fetchOfUs(originValue = 'https://lego.bigolin.online') {
  const auf = QUELLE.indexOf('function fromUs(');
  assert.ok(auf > 0, 'fromUs() is no longer in fehlerfang.js — is the rule still called that?');
  const zu = QUELLE.indexOf('\n}', auf) + 2;
  const text = QUELLE.slice(auf, zu);
  assert.ok(
    text.includes('location.origin'),
    'fromUs() no longer compares against the own origin — does the cut still work?',
  );
  // eslint-disable-next-line no-new-func
  return new Function('location', `${text}; return fromUs;`)({ origin: originValue });
}

const withStack = (message, stapel) => Object.assign(new Error(message), { stack: stapel });
const UNS = 'https://lego.bigolin.online';

test('an extension triggers no error with us', () => {
  const fromUs = fetchOfUs(UNS);
  // A real stack, as Chromium writes it.
  const metamask = withStack(
    'Failed to connect to MetaMask',
    'Error: MetaMask extension not found\n' +
      '    at Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/inpage.js:4:42708)\n' +
      '    at chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/inpage.js:7:84292',
  );
  assert.equal(fromUs(metamask), false, 'MetaMask still counts as our error');
  assert.equal(
    fromUs(withStack('x', 'Error: x\n    at moz-extension://abc/inpage.js:1:1')),
    false,
    'Firefox extensions count as our error',
  );
  assert.equal(
    fromUs(withStack('x', 'Error: x\n    at https://cdn.example.com/w.js:1:1')),
    false,
    'A foreign host counts as our error',
  );
});

test('our own errors still arrive', () => {
  const fromUs = fetchOfUs(UNS);
  assert.equal(
    fromUs(withStack('kaputt', `TypeError: kaputt\n    at h (${UNS}/js/app.bundle.js:428:12)`)),
    true,
    'An error from our bundle is swallowed',
  );
  assert.equal(
    fromUs(withStack('kaputt', `Error: kaputt\n    at ${UNS}/:17:3`)),
    true,
    'An error from the page itself is swallowed',
  );
  // An extension that calls OUR code and triggers something there is
  // our error: the stack names both, and one address of ours suffices.
  assert.equal(
    fromUs(withStack('x', `Error: x\n    at chrome-extension://abc/inpage.js:1:1\n    at ${UNS}/js/app.bundle.js:9:1`)),
    true,
    'An error in our code is swallowed because an extension triggered it',
  );
});

test('when in doubt the error counts as ours', () => {
  // The more expensive of the two mistakes is the concealed OWN error —
  // exactly against that this net exists. Without a stack or without a recognizable
  // address it is therefore still reported.
  const fromUs = fetchOfUs(UNS);
  assert.equal(fromUs('nur ein Text'), true, 'A rejection without a stack is swallowed');
  assert.equal(fromUs(undefined), true, 'A rejection without a value is swallowed');
  assert.equal(fromUs(withStack('x', 'Error: x\n    at <anonymous>')), true, 'A stack without an address is swallowed');
});

test('a foreign host with our name as its start does not count as ours', () => {
  // `startsWith(origin)` without the slash would read
  // https://lego.bigolin.online.boeswillig.example as ours.
  const fromUs = fetchOfUs(UNS);
  assert.equal(
    fromUs(withStack('x', `Error: x\n    at ${UNS}.boeswillig.example/w.js:1:1`)),
    false,
    'A foreign host that starts with our origin counts as ours',
  );
});

test('both listeners go through the check', () => {
  // Not only rejections: window 'error' catches script errors, and those of an extension land there too.
  // One window per listener: reportUnexpected() swallows a second report within five seconds.
  const { JSDOM } = require('jsdom');
  for (const name of ['unhandledrejection', 'error']) {
    const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: UNS + '/' }).window;
    const toasts = [];
    w.toast = text => toasts.push(text);
    w.tRaw = key => key;
    w.console.error = () => {};
    w.eval(`${QUELLE.replace(/^import .*$/gm, '').replace(/^export\s+/gm, '')}\nbindGlobalErrorHandlers();`);
    const fire = error => {
      const ev = new w.Event(name);
      Object.assign(ev, name === 'error' ? { error, message: error.message } : { reason: error });
      w.dispatchEvent(ev);
    };
    fire(withStack('x', 'Error: x\n    at chrome-extension://abc/inpage.js:1:1'));
    assert.deepEqual(toasts, [], `${name}: an error of an extension is reported as ours`);
    fire(withStack('y', `Error: y\n    at ${UNS}/js/app.bundle.js:1:1`));
    assert.deepEqual(toasts, ['api.unexpected'], `${name}: our own error does not arrive`);
    w.close();
  }
});

test('no leftover debugging in the delivered state', () => {
  // The second finding from the same console
  const ordner = path.join(__dirname, '..', 'public', 'js');
  const dateien = fs.readdirSync(ordner).filter(n => n.endsWith('.js') && n !== 'app.bundle.js');
  assert.ok(dateien.length >= 10, `Only ${dateien.length} scripts — does the search still match?`);

  const traces = [];
  for (const name of dateien) {
    fs.readFileSync(path.join(ordner, name), 'utf8')
      .split('\n')
      .forEach((z, i) => {
        if (/^\s*\/\//.test(z)) return;
        for (const m of z.matchAll(/console\.log\(\s*['"`]\[/g)) {
          void m;
          traces.push(`${name}:${i + 1}  ${z.trim().slice(0, 80)}`);
        }
      });
  }
  assert.deepEqual(
    traces,
    [],
    'These console.log calls look like debugging and are in the ' +
      'shipped state. They sit between the real messages.',
  );
});
