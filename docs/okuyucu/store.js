// Paketlerin telefonda saklanması (IndexedDB). Hiçbir şey sunucuya gitmez.
(function () {
  'use strict';
  const DB = 'scilex-okuyucu', VER = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB, VER);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(stores, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(stores, mode);
        let result;
        Promise.resolve(fn(t)).then(function (r) { result = r; });
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('İşlem iptal edildi')); };
      });
    });
  }

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  const Store = {
    async addBook(manifest, files) {
      const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const book = { id: id, title: manifest.title || 'Adsız', manifest: manifest, added: Date.now(),
                     pos: { page: 0, time: 0 }, opened: 0 };
      await tx(['books', 'files'], 'readwrite', function (t) {
        t.objectStore('books').put(book);
        const fs = t.objectStore('files');
        files.forEach(function (blob, name) {
          if (name !== 'manifest.json') fs.put(blob, id + '/' + name);
        });
      });
      return book;
    },
    async books() {
      const list = await tx(['books'], 'readonly', function (t) { return req(t.objectStore('books').getAll()); });
      return (list || []).sort(function (a, b) { return (b.opened || b.added) - (a.opened || a.added); });
    },
    async book(id) {
      return tx(['books'], 'readonly', function (t) { return req(t.objectStore('books').get(id)); });
    },
    async savePos(id, pos) {
      return tx(['books'], 'readwrite', async function (t) {
        const s = t.objectStore('books');
        const b = await req(s.get(id));
        if (b) { b.pos = pos; b.opened = Date.now(); s.put(b); }
      });
    },
    async file(id, name) {
      return tx(['files'], 'readonly', function (t) { return req(t.objectStore('files').get(id + '/' + name)); });
    },
    async remove(id) {
      return tx(['books', 'files'], 'readwrite', function (t) {
        t.objectStore('books').delete(id);
        t.objectStore('files').delete(IDBKeyRange.bound(id + '/', id + '/￿'));
      });
    },
    async persist() {
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    }
  };
  window.SciStore = Store;
})();
