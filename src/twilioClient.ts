import dotenv from 'dotenv';
import { closeAllConnections } from './callUtils';

dotenv.config();

// Multilingual rejection phrases
export const rejectionPhrases = {
  english: ["no", "wrong number", "not interested", "wrong person"],
  hindi: ["नहीं", "गलत नंबर", "रुचि नहीं है", "गलत व्यक्ति"],
  tamil: ["இல்லை", "தவறான எண்", "ஆர்வம் இல்லை", "தவறான நபர்"],
  telugu: ["లేదు", "తప్పు నంబర్", "ఆసక్తి లేదు", "తప్పు వ్యక్తి"],
  bengali: ["না", "ভুল নম্বর", "আগ্রহী নয়", "ভুল ব্যক্তি"],
  marathi: ["नाही", "चुकीचा नंबर", "रस नाही", "चुकीची व्यक्ती"]
};

// Function to end a call
export async function endCall(callSid: string): Promise<boolean> {
  try {
    console.log(`TWILIO_CLIENT: Ending call with SID: ${callSid}`);
    
    // Get the base URL from environment or use a default
    const baseUrl = process.env.PUBLIC_URL || "http://localhost:3000";
    
    // Method 1: Call the Twilio API endpoint
    try {
      console.log(`TWILIO_CLIENT: Calling Twilio API endpoint at ${baseUrl}/api/twilio/end-call`);
      const response = await fetch(`${baseUrl}/api/twilio/end-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          callSid: callSid,
        }),
      });
      
      if (response.ok) {
        console.log("TWILIO_CLIENT: Successfully ended call via Twilio API");
      } else {
        console.error("TWILIO_CLIENT: Failed to end call via Twilio API");
      }
    } catch (error) {
      console.error("TWILIO_CLIENT: Error calling Twilio API:", error);
    }
    
    // Method 2: Call the local hangup endpoint
    try {
      const baseUrl = process.env.BASE_URL || "http://localhost:8001";
      console.log(`TWILIO_CLIENT: Calling local hangup endpoint at ${baseUrl}/hangup`);
      await fetch(`${baseUrl}/hangup`, {
        method: "POST",
      });
      console.log("TWILIO_CLIENT: Successfully called local hangup endpoint");
    } catch (error) {
      console.error("TWILIO_CLIENT: Error calling local hangup endpoint:", error);
    }
    
    // Method 3: Try to directly close the WebSocket connection
    try {
      console.log("TWILIO_CLIENT: Directly closing WebSocket connections");
      closeAllConnections();
      console.log("TWILIO_CLIENT: Successfully closed all connections");
    } catch (error) {
      console.error("TWILIO_CLIENT: Error closing connections:", error);
    }
    
    return true;
  } catch (error) {
    console.error("TWILIO_CLIENT: Error ending call:", error);
    
    // Even if there's an error, try to close connections
    try {
      closeAllConnections();
    } catch (closeError) {
      console.error("TWILIO_CLIENT: Error in final attempt to close connections:", closeError);
    }
    
    return false;
  }
}
