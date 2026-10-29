// Küçük ZIP okuyucu: STORED ve (tarayıcı destekliyorsa) DEFLATE kayıtları.
// unzip(arrayBuffer) -> Promise<Map<ad, Blob>>
(function () {
  'use strict';
  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Bu tarayıcı sıkıştırılmış paketi açamıyor.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', png: 'image/png', jpg: 'image/jpeg',
                 jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
                 json: 'application/json' };

  async function unzip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // Merkez dizinin sonu (EOCD) kaydını sondan geriye ara.
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Geçerli bir SciLex paketi değil (ZIP bulunamadı).');
    const count = u16(view, eocd + 10);
    let pos = u32(view, eocd + 16);
    const decoder = new TextDecoder('utf-8');
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (u32(view, pos) !== 0x02014b50) throw new Error('Paket bozuk (merkez dizin).');
      const method = u16(view, pos + 10);
      const csize = u32(view, pos + 20);
      const nameLen = u16(view, pos + 28), extraLen = u16(view, pos + 30), commentLen = u16(view, pos + 32);
      const local = u32(view, pos + 42);
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      pos += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      const lNameLen = u16(view, local + 26), lExtraLen = u16(view, local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      let data = bytes.subarray(start, start + csize);
      if (method === 8) data = await inflate(data);
      else if (method !== 0) throw new Error('Desteklenmeyen sıkıştırma: ' + method);
      const ext = (name.split('.').pop() || '').toLowerCase();
      files.set(name, new Blob([data], { type: MIME[ext] || 'application/octet-stream' }));
    }
    return files;
  }
  window.SciUnzip = unzip;
})();
