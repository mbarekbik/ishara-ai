import { expect, test } from "vitest";
import { PcmEncoder } from "./pcmEncoder";
test("clamps and encodes little-endian PCM16; flushes partial chunks", () => {
  const chunks: ArrayBuffer[]=[]; const encoder=new PcmEncoder(16000, chunk=>chunks.push(chunk));
  encoder.write([new Float32Array([-2,-1,0,1,2])]); expect(chunks).toHaveLength(0); encoder.flush();
  const view=new DataView(chunks[0]); expect([0,2,4,6,8].map(offset=>view.getInt16(offset,true))).toEqual([-32768,-32768,0,32767,32767]);
  encoder.flush(); expect(chunks).toHaveLength(1);
});
test("100ms chunks use actual sample rate and downmix channels", () => {
  const chunks:ArrayBuffer[]=[]; const encoder=new PcmEncoder(48000,chunk=>chunks.push(chunk));
  encoder.write([new Float32Array(4800).fill(1),new Float32Array(4800).fill(-1)]);
  expect(chunks[0].byteLength).toBe(9600); expect(new Uint8Array(chunks[0]).every(value=>value===0)).toBe(true);
});
