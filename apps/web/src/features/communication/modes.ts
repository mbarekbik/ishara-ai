import type { CommunicationMode } from "./model";
export const modes = [
  {
    id: "sign",
    label: "sign",
    description: "signDescription",
    action: "signChoose",
    note: "optionalCamera",
  },
  {
    id: "voice",
    label: "voice",
    description: "voiceDescription",
    action: "voiceChoose",
    note: "noMicrophone",
  },
] as const;
export function isMode(value: string | null): value is CommunicationMode {
  return modes.some((mode) => mode.id === value);
}
