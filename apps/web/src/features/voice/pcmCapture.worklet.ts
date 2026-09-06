import { PcmEncoder } from "./pcmEncoder";

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private armed = false;
  private readonly encoder = new PcmEncoder(sampleRate, (buffer) => {
    this.port.postMessage({ type: "audio", buffer }, [buffer]);
  });

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const command = event.data;
      if (command === "start") this.armed = true;
      if (command === "flush") {
        this.armed = false;
        this.encoder.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // The graph remains connected for reliable processing, but never plays input.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.armed) this.encoder.write(inputs[0] ?? []);
    return true;
  }
}

registerProcessor("ishara-pcm-capture", PcmCaptureProcessor);
