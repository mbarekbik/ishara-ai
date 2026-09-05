export type CommunicationMode = "sign" | "voice";
export type MessageInputType = CommunicationMode | "text" | "ai";
export interface MessageSender {
  id: string;
  kind: "human" | "assistant";
}
export interface Participant {
  id: string;
  labelKey: "participant1" | "participant2";
}
export interface Message {
  id: string;
  sender: MessageSender;
  inputType: MessageInputType;
  text: string;
  language: string;
  createdAt: string;
  source: "mock" | "user" | "service";
  confidence?: number;
}
export interface CommunicationSession {
  id: string;
  startedAt: string;
  participants: Participant[];
  messages: Message[];
}
export type InteractionStatus =
  | "idle"
  | "capturing"
  | "listening"
  | "processing"
  | "success"
  | "error";
export type CameraStatus = "off" | "requesting" | "ready" | "error";
