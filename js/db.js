// Small promise wrapper around IndexedDB. This is the offline store; js/sync.js
// pushes changes to the central database whenever the device is online.
const DB = (() => {
  const NAME = 'werkbonnen';
  const VERSION = 4;
  // outbox: changes waiting to be sent to the central database
  // fotos: photos of a werkbon (image as a Blob), found through the werkbonId index
  // spwachtrij: changes waiting to be sent to SharePoint (js/sharepoint.js)
  const STORES = ['klanten', 'machines', 'onderdelen', 'werkbonnen', 'monteurs', 'settings', 'outbox', 'fotos', 'spwachtrij'];
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of STORES) {
            if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
          }
          const fotos = req.transaction.objectStore('fotos');
          if (!fotos.indexNames.contains('werkbonId')) fotos.createIndex('werkbonId', 'werkbonId');
        };
        // Another window still has an older version open: the upgrade waits until it is closed
        req.onblocked = () => showBlocked(true);
        req.onsuccess = () => {
          const db = req.result;
          showBlocked(false);
          // A newer version of the app was opened elsewhere: step aside so its upgrade can run
          db.onversionchange = () => { db.close(); location.reload(); };
          resolve(db);
        };
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function showBlocked(on) {
    let el = document.getElementById('db-blocked');
    if (!on) { el?.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = 'db-blocked';
    el.className = 'card';
    el.style.cssText = 'max-width:520px;margin:48px auto';
    el.innerHTML = '<h2>Sluit de andere vensters van de app</h2><p>De app is bijgewerkt, maar er staat nog een ander venster of tabblad van de app open met de oude versie. Sluit dat venster; deze pagina gaat dan vanzelf verder.</p>';
    (document.getElementById('view') || document.body).prepend(el);
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const req2p = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return {
    STORES,
    getAll: store => tx(store, 'readonly', s => req2p(s.getAll())),
    get: (store, id) => tx(store, 'readonly', s => req2p(s.get(id))),
    put: (store, obj) => tx(store, 'readwrite', s => { s.put(obj); return obj; }),
    del: (store, id) => tx(store, 'readwrite', s => { s.delete(id); }),
    clear: store => tx(store, 'readwrite', s => { s.clear(); }),
    bulkPut: (store, arr) => tx(store, 'readwrite', s => { for (const o of arr) s.put(o); return arr.length; }),
    bulkDel: (store, ids) => tx(store, 'readwrite', s => { for (const id of ids) s.delete(id); return ids.length; }),
    count: store => tx(store, 'readonly', s => req2p(s.count())),
    byIndex: (store, index, value) => tx(store, 'readonly', s => req2p(s.index(index).getAll(value))),
    // Delete only when the record still has this revision (it wasn't changed meanwhile)
    delIfRev: (store, id, rev) => tx(store, 'readwrite', s => {
      const r = s.get(id);
      r.onsuccess = () => { if (r.result && r.result.rev === rev) s.delete(id); };
    }),
  };
})();
