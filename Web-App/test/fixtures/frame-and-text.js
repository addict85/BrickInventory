// For test/test-run-text-output.test.js: writes a report frame on a tick
// and directly afterwards text whose third byte is not ASCII — the way the
// admin box and “✅ PostgreSQL schema ready" do during schema setup.
const test = require('node:test');
const { DefaultSerializer } = require('node:v8');

test('border and text alternating', () => {
  const s = new DefaultSerializer();
  s.writeHeader();
  s.writeValue({ type: 'test:diagnostic', data: { nesting: 0, message: 'rahmen', file: __filename } });
  const payload = s.releaseBuffer();
  const k = new DefaultSerializer();
  k.writeHeader();
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const frame = Buffer.concat([k.releaseBuffer(), len, payload]);
  for (let i = 0; i < 300; i++) {
    process.stdout.write(frame);
    process.stdout.write('✅ PostgreSQL schema ready\n');
  }
});
