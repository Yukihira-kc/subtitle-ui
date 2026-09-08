// Vercelの全画面から同じRenderサーバーに接続する。
window.SubtitleConnection = Object.freeze({
  version: 'v24',
  url: 'https://subtitle-server-czoz.onrender.com',
  connect() { return io(this.url); }
});
