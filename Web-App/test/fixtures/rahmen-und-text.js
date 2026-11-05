// Für test/test-lauf-textausgabe.test.js: schreibt im Takt einen Berichtsrahmen
// und direkt danach Text, dessen drittes Byte kein ASCII ist — so, wie es der
// Admin-Kasten und „✅ PostgreSQL schema ready" beim Schema-Aufbau tun.
const test = require('node:test');
const { DefaultSerializer } = require('node:v8');

test('Rahmen und Text abwechselnd', () => {
  const s = new DefaultSerializer();
  s.writeHeader();
  s.writeValue({ type: 'test:diagnostic', data: { nesting: 0, message: 'rahmen', file: __filename } });
  const nutzlast = s.releaseBuffer();
  const k = new DefaultSerializer();
  k.writeHeader();
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(nutzlast.length);
  const rahmen = Buffer.concat([k.releaseBuffer(), laenge, nutzlast]);
  for (let i = 0; i < 300; i++) {
    process.stdout.write(rahmen);
    process.stdout.write('✅ PostgreSQL schema ready\n');
  }
});
