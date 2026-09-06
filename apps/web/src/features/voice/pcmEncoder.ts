/** Streaming encoder: the only retained audio is the current 100 ms chunk. */
export class PcmEncoder {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset = 0;
  readonly framesPerChunk: number;

  constructor(sampleRate: number, private readonly emit: (buffer: ArrayBuffer) => void) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Invalid sample rate");
    this.framesPerChunk = Math.max(1, Math.round(sampleRate / 10));
    this.buffer = new ArrayBuffer(this.framesPerChunk * 2);
    this.view = new DataView(this.buffer);
  }

  write(channels: readonly Float32Array[]): void {
    const frames = channels[0]?.length ?? 0;
    for (let index = 0; index < frames; index++) {
      let mono = 0;
      for (const channel of channels) mono += channel[index] ?? 0;
      mono /= channels.length;
      const sample = Number.isFinite(mono) ? Math.max(-1, Math.min(1, mono)) : 0;
      this.view.setInt16(this.offset * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      if (++this.offset === this.framesPerChunk) this.flush();
    }
  }

  flush(): void {
    if (!this.offset) return;
    const complete = this.offset === this.framesPerChunk;
    const output = complete ? this.buffer : this.buffer.slice(0, this.offset * 2);
    this.offset = 0;
    this.buffer = new ArrayBuffer(this.framesPerChunk * 2);
    this.view = new DataView(this.buffer);
    this.emit(output);
  }
}
