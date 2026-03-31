/**
 * Client-side MP3 encoding using lamejs loaded via CDN (global script)
 * Slices an AudioBuffer and encodes each segment to MP3
 */

let lamejsLoaded = false;

async function ensureLamejs(): Promise<void> {
  if (lamejsLoaded && (window as any).lamejs) return;
  return new Promise((resolve, reject) => {
    if ((window as any).lamejs) { lamejsLoaded = true; resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";
    script.onload = () => { lamejsLoaded = true; resolve(); };
    script.onerror = () => reject(new Error("Failed to load lamejs"));
    document.head.appendChild(script);
  });
}

export async function sliceAndEncode(
  audioBuffer: AudioBuffer,
  startSec: number,
  endSec: number,
  fadeOutSec: number = 0.3
): Promise<Blob> {
  await ensureLamejs();
  const L = (window as any).lamejs;
  if (!L?.Mp3Encoder) throw new Error("lamejs not available");

  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.floor(startSec * sampleRate);
  const endSample = Math.min(Math.floor(endSec * sampleRate), audioBuffer.length);
  const length = endSample - startSample;

  const channels = audioBuffer.numberOfChannels;
  const left = audioBuffer.getChannelData(0).slice(startSample, endSample);
  const right = channels > 1
    ? audioBuffer.getChannelData(1).slice(startSample, endSample)
    : left;

  // Apply fade out
  const fadeSamples = Math.floor(fadeOutSec * sampleRate);
  const fadeStart = length - fadeSamples;
  if (fadeStart > 0) {
    for (let i = fadeStart; i < length; i++) {
      const factor = 1 - (i - fadeStart) / fadeSamples;
      left[i] *= factor;
      if (channels > 1) right[i] *= factor;
    }
  }

  // Convert to 16-bit PCM
  const leftPcm = floatTo16BitPCM(left);
  const rightPcm = floatTo16BitPCM(right);

  // Encode
  const encoder = new L.Mp3Encoder(channels, sampleRate, 128);
  const mp3Chunks: Uint8Array[] = [];

  const blockSize = 1152;
  for (let i = 0; i < leftPcm.length; i += blockSize) {
    const leftChunk = leftPcm.subarray(i, i + blockSize);
    const rightChunk = rightPcm.subarray(i, i + blockSize);
    const mp3buf = channels > 1
      ? encoder.encodeBuffer(leftChunk, rightChunk)
      : encoder.encodeBuffer(leftChunk);
    if (mp3buf.length > 0) mp3Chunks.push(new Uint8Array(mp3buf));
  }

  const end_buf = encoder.flush();
  if (end_buf.length > 0) mp3Chunks.push(new Uint8Array(end_buf));

  return new Blob(mp3Chunks as BlobPart[], { type: "audio/mp3" });
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/** Encode multiple time ranges into a single MP3 (concatenated) */
export async function sliceAndEncodeMulti(
  audioBuffer: AudioBuffer,
  ranges: { start: number; end: number }[],
  fadeOutSec: number = 0.3
): Promise<Blob> {
  await ensureLamejs();
  const L = (window as any).lamejs;
  if (!L?.Mp3Encoder) throw new Error("lamejs not available");

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const encoder = new L.Mp3Encoder(channels, sampleRate, 128);
  const mp3Chunks: Uint8Array[] = [];
  const blockSize = 1152;

  for (let ri = 0; ri < ranges.length; ri++) {
    const { start: startSec, end: endSec } = ranges[ri];
    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.min(Math.floor(endSec * sampleRate), audioBuffer.length);
    const length = endSample - startSample;

    const left = audioBuffer.getChannelData(0).slice(startSample, endSample);
    const right = channels > 1
      ? audioBuffer.getChannelData(1).slice(startSample, endSample)
      : left;

    // Apply fade out only on the last range
    if (ri === ranges.length - 1) {
      const fadeSamples = Math.floor(fadeOutSec * sampleRate);
      const fadeStart = length - fadeSamples;
      if (fadeStart > 0) {
        for (let i = fadeStart; i < length; i++) {
          const factor = 1 - (i - fadeStart) / fadeSamples;
          left[i] *= factor;
          if (channels > 1) right[i] *= factor;
        }
      }
    }

    const leftPcm = floatTo16BitPCM(left);
    const rightPcm = floatTo16BitPCM(right);

    for (let i = 0; i < leftPcm.length; i += blockSize) {
      const leftChunk = leftPcm.subarray(i, i + blockSize);
      const rightChunk = rightPcm.subarray(i, i + blockSize);
      const mp3buf = channels > 1
        ? encoder.encodeBuffer(leftChunk, rightChunk)
        : encoder.encodeBuffer(leftChunk);
      if (mp3buf.length > 0) mp3Chunks.push(new Uint8Array(mp3buf));
    }
  }

  const end_buf = encoder.flush();
  if (end_buf.length > 0) mp3Chunks.push(new Uint8Array(end_buf));

  return new Blob(mp3Chunks as BlobPart[], { type: "audio/mp3" });
}

export async function exportAllSegments(
  audioBuffer: AudioBuffer,
  boundaries: number[],
  audioDuration: number
): Promise<{ name: string; blob: Blob }[]> {
  const results: { name: string; blob: Blob }[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = i < boundaries.length - 1 ? boundaries[i + 1] : audioDuration;
    const blob = await sliceAndEncode(audioBuffer, start, end);
    results.push({ name: `課題${i + 1}.mp3`, blob });
  }
  return results;
}
