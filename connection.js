// 通常はVercelの全画面からRenderサーバーに接続する。ローカル試験サーバー上だけは同じlocalhostへ接続する。
window.SubtitleConnection = Object.freeze({
  version: 'v28',
  url: ['localhost','127.0.0.1'].includes(location.hostname) ? location.origin : 'https://subtitle-server-czoz.onrender.com',
  connect() { return io(this.url); }
});
