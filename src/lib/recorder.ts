// Ghi âm bằng MediaRecorder rồi chuyển sang WAV 16 kHz mono (định dạng AI đọc được trên mọi điện thoại).

export type Recording = { stop: () => Promise<Blob>; cancel: () => void; level: () => number };

export function micSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);

  // Đo độ lớn tiếng để hiển thị vạch sóng
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const level = () => {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += (v - 128) ** 2;
    return Math.min(1, Math.sqrt(sum / buf.length) / 40);
  };

  const cleanup = () => { stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); };
  return {
    level,
    cancel: () => { try { rec.stop(); } catch { /* đã dừng */ } cleanup(); },
    stop: () => new Promise<Blob>((resolve) => {
      rec.onstop = () => { cleanup(); resolve(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" })); };
      rec.stop();
    }),
  };
}

/** Giải mã bản ghi và xuất WAV PCM 16-bit, 16 kHz, mono; trả về base64 (không có tiền tố data:). */
export async function toWav16kBase64(blob: Blob): Promise<{ base64: string; seconds: number }> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const decoded = await new Promise<AudioBuffer>((res, rej) => {
    blob.arrayBuffer().then((ab) => ctx.decodeAudioData(ab, res, rej), rej);
  });
  ctx.close().catch(() => {});
  const rate = 16000;
  const length = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OfflineAudioContext(1, length, rate);
  const s = off.createBufferSource();
  s.buffer = decoded;
  s.connect(off.destination);
  s.start();
  const out = await off.startRendering();
  const pcm = out.getChannelData(0);

  const bytes = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(bytes);
  const w = (o: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  const u8 = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { base64: btoa(bin), seconds: decoded.duration };
}
