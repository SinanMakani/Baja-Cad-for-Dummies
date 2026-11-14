// Checks the claude.ai Artifact helpers (src/platform/artifact.js): outside an
// artifact nothing is rerouted, and the .zip wrapper used to save STL/GLB from
// an artifact holds the original file byte for byte.
import zlib from 'node:zlib';
import { inArtifact, crc32, zipSingle } from '../src/platform/artifact.js';

let failed = 0;
function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

report('not treated as an artifact outside claude.ai', inArtifact === false);

const bytes = Uint8Array.from({ length: 200003 }, (_, i) => (i * 131 + (i >> 9)) & 0xff);
const want = zlib.crc32(bytes) >>> 0;
report('CRC-32 matches zlib', crc32(bytes) === want, want.toString(16));

const name = 'Frame v2 – bent hoop.stl';
const zip = new Uint8Array(await (await zipSingle(name, new Blob([bytes]), new Date(2026, 10, 6, 14, 30, 8))).arrayBuffer());
const v = new DataView(zip.buffer);
const end = zip.length - 22;
const cd = v.getUint32(end + 16, true);
const nameLen = v.getUint16(26, true);
const size = v.getUint32(22, true);
const stored = zip.subarray(30 + nameLen, 30 + nameLen + size);
report('end record points at one central entry', v.getUint32(end, true) === 0x06054b50 && v.getUint16(end + 10, true) === 1 && v.getUint32(cd, true) === 0x02014b50);
report('central entry matches the local header', v.getUint32(cd + 16, true) === want && v.getUint32(cd + 24, true) === bytes.length && v.getUint32(cd + 42, true) === 0);
report('local header: stored, UTF-8 name, CRC', v.getUint32(0, true) === 0x04034b50 && v.getUint16(8, true) === 0 && (v.getUint16(6, true) & 0x0800) !== 0 && v.getUint32(14, true) === want);
report('file name and contents round-trip', new TextDecoder().decode(zip.subarray(30, 30 + nameLen)) === name && Buffer.compare(Buffer.from(stored), Buffer.from(bytes)) === 0, `${zip.length} bytes`);

// Inside the claude.ai viewer: a stand-in window.claude whose save prompt
// records each request, declining the ones named "decline…".
const saves = [];
const save = async (req) => {
  saves.push(req);
  if (req.filename.startsWith('decline')) throw { code: 'declined', message: 'no' };
  return { status: 'saved' };
};
globalThis.window = { claude: { use: async (n) => (n === 'downloads' ? Object.freeze({ save }) : null) } };
globalThis.window.top = globalThis.window;
const inside = await import('../src/platform/artifact.js?in-artifact');
const notes = [];
const hooks = { notify: (m) => notes.push(m), fallback: () => notes.push('link download') };
await inside.artifactDownload('cut-list.csv', new Blob(['Tube,Length\n']), hooks);
await inside.artifactDownload('Starter car.stl', new Blob([bytes]), hooks);
await inside.artifactDownload('decline.png', new Blob([bytes]), hooks);
const zipped = saves[1] && new Uint8Array(await saves[1].data.arrayBuffer());
report('detected inside an artifact', inside.inArtifact === true);
report('CSV goes to the save prompt unchanged', saves[0]?.filename === 'cut-list.csv' && saves[0].data instanceof Blob);
report('STL goes to the save prompt as a .zip', saves[1]?.filename === 'Starter car.stl.zip' && zipped?.length === 30 + 15 + bytes.length + 46 + 15 + 22, saves[1]?.filename);
report('a declined save shows nothing and never falls back to a link', saves.length === 3 && notes.length === 1 && /Unzip/.test(notes[0]), notes.join(' | '));

if (failed) { console.log(`\n${failed} artifact check(s) failed`); process.exit(1); }
console.log('\nAll artifact checks passed');
