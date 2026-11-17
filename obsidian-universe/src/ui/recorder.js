// Records the universe with MediaRecorder and downloads the clip when stopped.
// Frames are copied right after each render into a canvas whose size video encoders accept
// (even, multiple of 16, at most 2560 wide); the raw WebGL canvas can be any size.
const TYPES = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export class Recorder {
  constructor(onChange) {
    this.onChange = onChange;
    this.rec = null;
    this.universe = null;
    this.started = 0;
    this.timer = null;
  }

  get recording() { return Boolean(this.rec); }

  toggle(universe) { return this.recording ? this.stop() : this.start(universe); }

  start(universe) {
    const src = universe.canvas;
    const out = document.createElement('canvas');
    if (!window.MediaRecorder || !out.captureStream) {
      this.onChange({ error: 'Recording is not supported in this browser.' });
      return;
    }
    const scale = Math.min(1, 2560 / src.width);
    out.width = Math.max(16, Math.floor((src.width * scale) / 16) * 16);
    out.height = Math.max(16, Math.floor((src.height * scale) / 16) * 16);
    const ctx = out.getContext('2d', { alpha: false });
    const sx = (src.width - out.width / scale) / 2;
    const sy = (src.height - out.height / scale) / 2;
    universe.frameSink = (c) => ctx.drawImage(c, sx, sy, out.width / scale, out.height / scale, 0, 0, out.width, out.height);

    const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const stream = out.captureStream(60);
    const chunks = [];
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: 24_000_000 });
    } catch (err) {
      universe.frameSink = null;
      this.onChange({ error: `Recording failed: ${err.message}` });
      return;
    }
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => this.onChange({ error: `Recording failed: ${e.error?.message || 'encoder error'}` });
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      if (!blob.size) {
        this.onChange({ error: 'The recording came out empty. Try a shorter clip or another browser.' });
        return;
      }
      const ext = (rec.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `obsidian-universe-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      this.onChange({ saved: a.download, seconds: Math.round((Date.now() - this.started) / 1000), size: blob.size });
    };
    rec.start(250);
    this.rec = rec;
    this.universe = universe;
    this.started = Date.now();
    this.timer = setInterval(() => this.onChange({ recording: true, seconds: (Date.now() - this.started) / 1000 }), 250);
    this.onChange({ recording: true, seconds: 0 });
  }

  stop() {
    if (!this.rec) return;
    clearInterval(this.timer);
    const rec = this.rec;
    this.rec = null;
    if (this.universe) this.universe.frameSink = null;
    this.universe = null;
    rec.stop();
    this.onChange({ recording: false });
  }
}
