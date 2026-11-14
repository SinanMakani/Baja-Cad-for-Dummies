// claude.ai Artifact integration. This is the only artifact-specific code in
// the app, and it does nothing anywhere else.
//
// The claude.ai viewer defines window.claude (with a use() method) before the
// page's own scripts run. The Vite dev server, `vite preview`, a saved copy or
// any other static host has no window.claude, so `inArtifact` is false there
// and callers keep their normal browser behavior.
//
// Inside the viewer the page runs in a sandboxed frame that ignores
// <a download> clicks. Files are offered through the artifact's `downloads`
// capability instead: the viewer sees the file name and size and confirms.
// The save prompt only takes certain file types (no .stl or .glb), so other
// files are wrapped in a .zip that holds the original file unchanged.

const claude = globalThis.window?.claude;

/** True when the page is running as a claude.ai Artifact. */
export const inArtifact = typeof claude?.use === 'function';

// File types the save prompt accepts (downloads capability, runtime contract 0.2.96).
const SAVE_EXT = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'txt', 'json', 'md',
  'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip', 'fig']);

// Start loading the capability right away. use() never prompts; save() does.
const downloadsReady = inArtifact ? claude.use('downloads').catch(() => null) : Promise.resolve(null);

const extOf = (name) => (/\.([^./\\]+)$/.exec(name)?.[1] || '').toLowerCase();

/**
 * Offer a file through the viewer's save prompt.
 * `notify(message, kind, ms)` shows a toast. `fallback(filename, blob)` is the
 * normal link download, used when the page is open on its own (not inside the
 * viewer frame), where the capability isn't served.
 */
export async function artifactDownload(filename, blob, { notify, fallback }) {
  const downloads = await downloadsReady;
  if (!downloads) {
    if (window.top === window) fallback(filename, blob);
    else notify("Saving files isn't available in this view.", 'warn', 5000);
    return;
  }
  const zipped = !SAVE_EXT.has(extOf(filename));
  const name = zipped ? `${filename}.zip` : filename;
  try {
    await downloads.save({ filename: name, data: zipped ? await zipSingle(filename, blob) : blob });
    if (zipped) notify(`Saved ${name}. Unzip it to get the .${extOf(filename)} file.`, 'ok', 6000);
  } catch (e) {
    const message = saveError(e?.code, filename, name);
    if (message) notify(message, 'warn', 6000);
  }
}

function saveError(code, filename, name) {
  switch (code) {
    case 'declined': return null; // the viewer chose not to save
    case 'rate_limited': return 'Another save is still waiting for an answer. Finish that one, then try again.';
    case 'rejected_extension':
    case 'extension_not_enabled': return `This view can't save .${extOf(filename)} files.`;
    case 'too_large': return `${name} is too large to save from this view.`;
    case 'bad_request':
    case 'transform_error': return `Couldn't save ${name}.`;
    default: return "Saving files isn't available in this view.";
  }
}

// ------------------------------------------------------------------ zip
// One stored (uncompressed) entry: enough to carry a file type the save prompt
// doesn't accept, byte for byte.

let crcTable;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A .zip archive holding one file, stored without compression. */
export async function zipSingle(name, blob, date = new Date()) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const fname = new TextEncoder().encode(name);
  const crc = crc32(data);
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  // The local file header and the central directory entry share most fields.
  const header = (central) => {
    const bytes = new Uint8Array((central ? 46 : 30) + fname.length);
    const v = new DataView(bytes.buffer);
    let o = 0;
    const u16 = (x) => { v.setUint16(o, x, true); o += 2; };
    const u32 = (x) => { v.setUint32(o, x, true); o += 4; };
    u32(central ? 0x02014b50 : 0x04034b50);
    if (central) u16(20); // version made by: 2.0
    u16(20); // version needed to extract: 2.0
    u16(0x0800); // flags: file name is UTF-8
    u16(0); // method: stored
    u16(time); u16(day);
    u32(crc); u32(data.length); u32(data.length);
    u16(fname.length);
    u16(0); // extra field length
    if (central) { u16(0); u16(0); u16(0); u32(0); u32(0); } // comment, disk, attributes, local header at offset 0
    bytes.set(fname, o);
    return bytes;
  };
  const local = header(false), central = header(true);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, 1, true); // entries on this disk
  v.setUint16(10, 1, true); // entries in total
  v.setUint32(12, central.length, true); // central directory size
  v.setUint32(16, local.length + data.length, true); // central directory offset
  return new Blob([local, data, central, end], { type: 'application/zip' });
}
