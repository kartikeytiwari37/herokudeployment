import { WebSocket } from "ws";

// Session state
export interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  streamSid?: string;
  saved_config?: any;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  openAIApiKey?: string;
  openAIModel?: string;
  // Legacy Azure OpenAI properties (kept for backward compatibility)
  azureOpenAIApiKey?: string;
  azureOpenAIEndpoint?: string;
  azureOpenAIDeploymentName?: string;
  azureOpenAIVersion?: string;
  customerName?: string;
  customerLocation?: string;
  customerProduct?: string;
  disconnectCheckScheduled?: boolean;
}

// Shared session object
export let session: Session = {};

// Function to update session properties
export function updateSession(updates: Partial<Session>) {
  session = { ...session, ...updates };
}

// Function to clear session
export function clearSession() {
  session = {};
}

// Utility function to check if a WebSocket is open
export function isOpen(ws?: WebSocket): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

// Utility function to clean up a WebSocket connection
export function cleanupConnection(ws?: WebSocket) {
  if (isOpen(ws)) ws.close();
}

// Function to close all connections
export function closeAllConnections() {
  console.log("===== CLOSE ALL CONNECTIONS CALLED =====");
  
  try {
    // Close all WebSocket connections
    if (session.twilioConn) {
      console.log("Closing Twilio connection");
      try {
        if (session.streamSid) {
          console.log(`Sending close event for stream ${session.streamSid}`);
          jsonSend(session.twilioConn, {
            event: "close",
            streamSid: session.streamSid
          });
        }
        session.twilioConn.close();
        console.log("Twilio connection closed successfully");
      } catch (error) {
        console.error("Error closing Twilio connection:", error);
      }
    } else {
      console.log("No Twilio connection to close");
    }
    
    if (session.modelConn) {
      console.log("Closing model connection");
      try {
        session.modelConn.close();
        console.log("Model connection closed successfully");
      } catch (error) {
        console.error("Error closing model connection:", error);
      }
    } else {
      console.log("No model connection to close");
    }
    
    if (session.frontendConn) {
      console.log("Closing frontend connection");
      try {
        jsonSend(session.frontendConn, {
          type: "call.ended",
          timestamp: new Date().toISOString()
        });
        session.frontendConn.close();
        console.log("Frontend connection closed successfully");
      } catch (error) {
        console.error("Error closing frontend connection:", error);
      }
    } else {
      console.log("No frontend connection to close");
    }
    
    // Reset the session
    console.log("Clearing session data");
    clearSession();
    
    console.log("===== ALL CONNECTIONS CLOSED AND SESSION CLEARED =====");
  } catch (error) {
    console.error("Error in closeAllConnections:", error);
    // Force clear the session even if there was an error
    clearSession();
  }
}

// Utility function to send JSON data over WebSocket
export function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (!isOpen(ws)) return;
  ws.send(JSON.stringify(obj));
}

// Utility function to parse WebSocket messages
export function parseMessage(data: any): any {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}
