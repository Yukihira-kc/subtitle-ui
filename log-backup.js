(function () {
  'use strict';
  const INTERVAL = 30000;
  const DATABASE = 'subtitle-log-backups-v1';
  const $ = id => document.getElementById(id);

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('端末内保存を利用できません'));
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        for (const name of ['records', 'sessions']) {
          const store = request.result.createObjectStore(name, {keyPath: 'key'});
          store.createIndex('scope', 'scope');
        }
        request.result.createObjectStore('folders');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('別の画面が保存領域を使用しています'));
    });
  }
  function transaction(db, stores, write, operation) {
    return new Promise((resolve, reject) => {
      let tx, result;
      try {
        try { tx = db.transaction(stores, write ? 'readwrite' : 'readonly', {durability: 'strict'}); }
        catch (error) { if (error.name !== 'TypeError') throw error; tx = db.transaction(stores, write ? 'readwrite' : 'readonly'); }
        operation(tx, value => { result = value; });
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('保存処理に失敗しました'));
      } catch (error) { reject(error); }
    });
  }
  const time = value => new Date(value).toLocaleTimeString('ja-JP', {hour12: false});
  const stamp = value => {
    const d = new Date(value), pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  };
  const safe = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  function asText(record) {
    const items = record.items ? [...record.items.values()] : record.entries;
    const lines = [...items].sort((a, b) => a.id - b.id).flatMap(item => item.lines);
    const pending = record.pendingDisplays instanceof Map ? [...record.pendingDisplays.values()] : record.pendingDisplays || [];
    const uncertain = pending.filter(item => !items.some(confirmed => confirmed.id === item.id)).sort((a, b) => a.id - b.id);
    if (uncertain.length) {
      if (lines.length) lines.push('');
      lines.push('【表示字幕の控え（ログ未確定）】', ...uncertain.flatMap(item => item.lines));
    }
    return '\ufeff' + (lines.length ? lines.join('\r\n') + '\r\n' : '');
  }

  function create({scope, roomId}) {
    let dbPromise, active = null, directory = null, permission = '', folderError = '', fileError = '';
    let diskQueue = Promise.resolve(), fileWrites = 0, folderSelection = 0;
    const records = new Map(), summaries = new Map();
    const supportsFiles = typeof window.showDirectoryPicker === 'function';
    const database = () => dbPromise || (dbPromise = openDatabase().catch(error => { dbPromise = null; throw error; }));
    const read = async (store, key) => transaction(await database(), [store], false, (tx, done) => {
      const request = tx.objectStore(store).get(key); request.onsuccess = () => done(request.result);
    });
    function metadata(record) {
      const uncertain = [...record.pendingDisplays.keys()].filter(id => !record.items.has(id)).length;
      return {key: record.key, scope, session: record.session, filename: record.filename, startedAt: record.startedAt, updatedAt: record.updatedAt, count: record.items.size + uncertain};
    }
    function renderArchives() {
      const select = $('log-archive'), previous = select.value;
      select.replaceChildren(new Option('今回のログ', ''));
      [...summaries.values()].filter(item => item.key !== active?.key).sort((a, b) => b.startedAt - a.startedAt).forEach(item => {
        select.add(new Option(new Date(item.startedAt).toLocaleString('ja-JP') + '（' + item.count + '件）', item.key));
      });
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
    }
    function render() {
      const local = $('log-backup-state'), file = $('log-file-state');
      local.textContent = active?.localError ? '端末内バックアップ：保存失敗' : active?.localSavedAt ? '端末内バックアップ：' + time(active.localSavedAt) + ' 保存済み' : '端末内バックアップ：' + (active ? '保存待ち' : '接続待ち');
      if (!supportsFiles) file.textContent = 'TXT自動保存：このブラウザは未対応です';
      else if (fileError) file.textContent = 'TXT自動保存：保存失敗';
      else if (!directory || permission !== 'granted') file.textContent = 'TXT自動保存：' + (directory ? '保存先の許可が必要です' : '未設定 — 保存先を選択してください');
      else file.textContent = 'TXT自動保存：' + (active?.fileSavedAt ? time(active.fileSavedAt) + ' 保存済み（30秒ごと）' : '保存準備中');
      file.classList.toggle('save-warning', !supportsFiles || !directory || permission !== 'granted' || !!fileError);
      $('log-folder').disabled = !supportsFiles || !active;
      $('log-folder').textContent = directory && permission !== 'granted' ? 'TXT自動保存を再開' : directory ? '保存フォルダーを変更' : 'TXT自動保存の保存先を選択';
      $('log-export').disabled = !active && !summaries.size;
      $('log-save-error').textContent = [active?.localError && '端末内保存に失敗しました。TXT保存を行い、保存先の空き容量などを確認してください。', fileError && 'TXTを更新できませんでした。保存先を確認してください。前回の保存成功時刻は ' + (active?.fileSavedAt ? time(active.fileSavedAt) : '未保存') + ' です。', folderError].filter(Boolean).join(' ');
    }
    function loadRecord(record) {
      if (record.loaded) return Promise.resolve();
      if (record.loading) return record.loading;
      record.loading = read('records', record.key).then(saved => {
        if (saved) {
          for (const item of saved.entries || []) if (!record.items.has(item.id)) record.items.set(item.id, item);
          for (const item of saved.pendingDisplays || []) if (!record.pendingDisplays.has(item.id)) record.pendingDisplays.set(item.id, item);
          if (!record.captureKnown) record.display = saved.display || null;
          record.startedAt = saved.startedAt; record.filename = saved.filename;
        }
        for (const id of record.items.keys()) record.pendingDisplays.delete(id);
        record.loaded = true; record.localError = ''; summaries.set(record.key, metadata(record)); renderArchives();
      }).catch(error => { record.localError = error.message; throw error; }).finally(() => { record.loading = null; render(); });
      return record.loading;
    }
    function persist(record) {
      record.saveWanted = true;
      if (record.saving) return record.saving;
      record.saving = (async () => {
        await loadRecord(record);
        while (record.saveWanted) {
          record.saveWanted = false;
          const revision = record.revision, info = metadata(record);
          const data = {...info, entries: [...record.items.values()], display: record.display, pendingDisplays: [...record.pendingDisplays.values()]};
          await transaction(await database(), ['records', 'sessions'], true, tx => {
            tx.objectStore('records').put(data); tx.objectStore('sessions').put(info);
          });
          record.savedRevision = revision; record.localSavedAt = Date.now(); record.localError = '';
          summaries.set(record.key, info); renderArchives(); render();
        }
      })().catch(error => { record.localError = error.message; render(); }).finally(() => { record.saving = null; });
      return record.saving;
    }
    function writeFile(record, force = false) {
      if (!record || !directory || permission !== 'granted') return Promise.resolve();
      const folder = directory;
      fileWrites++;
      diskQueue = diskQueue.catch(() => {}).then(async () => {
        // Merge the previous backup before replacing a file with the same name.
        await loadRecord(record);
        if (!force && record.fileRevision === record.revision) return;
        const revision = record.revision;
        const file = await folder.getFileHandle(record.filename, {create: true});
        const writer = await file.createWritable();
        try { await writer.write(asText(record)); await writer.close(); }
        catch (error) { try { await writer.abort(); } catch (_) {} throw error; }
        record.fileRevision = revision; record.fileSavedAt = Date.now(); fileError = '';
      }).catch(error => { fileError = error.message || 'TXT保存に失敗しました'; }).finally(() => { fileWrites--; render(); });
      return diskQueue;
    }
    async function restoreFolder() {
      if (!supportsFiles) return;
      const selection = folderSelection;
      try {
        const saved = await read('folders', scope) || null;
        const granted = saved ? await saved.queryPermission({mode: 'readwrite'}) : '';
        if (selection !== folderSelection) return;
        directory = saved; permission = granted;
        render(); if (active) writeFile(active);
      } catch (_) { folderError = '保存先を復元できませんでした。保存先を選択し直してください。'; render(); }
    }
    $('log-folder').onclick = async () => {
      folderSelection++;
      try {
        if (directory && permission !== 'granted') {
          permission = await directory.requestPermission({mode: 'readwrite'});
          if (permission !== 'granted') { directory = null; folderError = '保存先への書き込みが許可されていません。'; render(); return; }
        } else {
          directory = await window.showDirectoryPicker({id: 'subtitle-log-folder', mode: 'readwrite'});
          permission = 'granted';
        }
        folderError = ''; fileError = '';
        try { await transaction(await database(), ['folders'], true, tx => tx.objectStore('folders').put(directory, scope)); }
        catch (_) { folderError = '保存先の記憶に失敗しました。次回は保存先を選び直してください。'; }
        render(); if (active) await writeFile(active, true);
      } catch (error) { if (error.name !== 'AbortError') { fileError = error.message; render(); } }
    };
    function download(record) {
      const blob = new Blob([asText(record)], {type: 'text/plain;charset=utf-8'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = record.filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    $('log-export').onclick = async () => {
      try {
        const key = $('log-archive').value;
        if (key) { const saved = await read('records', key); if (!saved || saved.scope !== scope) throw new Error('保存済みログを読み出せません'); download(saved); }
        else if (active) { try { await loadRecord(active); } catch (_) {} download(active); }
      } catch (error) { $('log-save-error').textContent = 'TXTを書き出せませんでした。' + error.message; }
    };
    async function restoreArchives() {
      try {
        const found = await transaction(await database(), ['sessions'], false, (tx, done) => {
          const request = tx.objectStore('sessions').index('scope').getAll(scope); request.onsuccess = () => done(request.result);
        });
        for (const item of found) if (!summaries.has(item.key)) summaries.set(item.key, item);
        renderArchives(); render();
      } catch (_) { /* An active session reports its own storage error. */ }
    }
    function start(session) {
      if (!session || active?.session === session) return;
      if (active) { persist(active); writeFile(active); }
      const key = scope + '|' + session;
      if (!records.has(key)) {
        const startedAt = Date.now();
        records.set(key, {key, session, startedAt, updatedAt: startedAt, filename: 'subtitle-' + safe(roomId) + '-' + stamp(startedAt) + '-' + safe(session) + '.txt', items: new Map(), pendingDisplays: new Map(), display: null, captureKnown: false, revision: 0, savedRevision: -1, fileRevision: -1, loaded: false});
      }
      active = records.get(key); fileError = ''; persist(active); writeFile(active); renderArchives(); render();
    }
    function add(item) {
      if (!active || !Number.isSafeInteger(item?.id) || !Array.isArray(item.lines) || item.lines.some(line => typeof line !== 'string')) return;
      if (active.items.has(item.id)) return;
      active.items.set(item.id, {id: item.id, lines: [...item.lines], at: item.at});
      active.pendingDisplays.delete(item.id);
      active.updatedAt = Date.now(); active.revision++; persist(active);
    }
    function capture(item) {
      if (!active || !Number.isSafeInteger(item?.id) || !Array.isArray(item.lines) || item.lines.some(line => typeof line !== 'string')) return;
      active.captureKnown = true;
      if (active.display?.id === item.id && JSON.stringify(active.display.lines) === JSON.stringify(item.lines)) return;
      active.display = {id: item.id, lines: [...item.lines]};
      // A quick OUT or a disconnect can precede the server's presentation ACK.
      // Keep that text as an explicitly unconfirmed copy instead of dropping it.
      if (item.lines.length && !active.items.has(item.id)) active.pendingDisplays.set(item.id, active.display);
      active.updatedAt = Date.now(); active.revision++; persist(active);
    }
    const tick = () => { if (active) { persist(active); writeFile(active); } };
    setInterval(tick, INTERVAL);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tick(); });
    window.addEventListener('pagehide', tick);
    window.addEventListener('beforeunload', event => {
      if ((active?.items.size || active?.pendingDisplays.size) && (active.savedRevision !== active.revision || (directory && permission === 'granted' && (active.fileRevision !== active.revision || fileWrites)))) {
        tick(); event.preventDefault(); event.returnValue = '';
      }
    });
    $('log-save-help').textContent = supportsFiles ? 'ログは受信時に端末内へ保存します。保存先を選ぶと、30秒ごとにルーム別のTXTを更新します。' : '端末内バックアップは有効です。フォルダーへのTXT自動保存には対応ブラウザ（Chrome・Edgeなど）を使用してください。';
    restoreArchives(); restoreFolder(); render();
    return Object.freeze({start, add, capture});
  }
  window.SubtitleLogBackup = Object.freeze({create});
})();
