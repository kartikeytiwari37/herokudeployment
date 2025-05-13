import { WebSocket } from "ws";

export interface AIConfig {
  provider: string;
  openai: {
    apiKey: string;
  };
  azure: {
    apiKey: string;
    endpoint: string;
    deploymentName: string;
    version: string;
  };
  azureAnalysis?: {
    apiKey: string;
    endpoint: string;
    deploymentId: string;
    apiVersion: string;
  };
}

export interface Session {
  twilioConn?: WebSocket;
  modelConn?: WebSocket;
  streamSid?: string;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  aiConfig?: AIConfig;
  callSid?: string;
  phoneNumber?: string;
  customerName?: string;
  customerLocation?: string;
  customerProduct?: string;
  transcript: TranscriptItem[];
  disconnectReason?: string;
}

export interface TranscriptItem {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  itemId?: string;
}

export interface TwilioMessage {
  event: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    callSid: string;
  };
  media?: {
    payload: string;
    timestamp: number;
  };
}

export interface OpenAIMessage {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  part?: {
    type: string;
    text: string;
  };
  output_index?: number;
  item?: {
    id?: string;
    type: string;
    role?: string;
    name?: string;
    arguments?: string;
    content?: Array<{
      type: string;
      text: string;
    }>;
  };
}
