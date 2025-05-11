import { FunctionHandler } from "./types";
import { closeAllConnections } from "./callUtils";
import { endCall } from "./twilioClient";

const functions: FunctionHandler[] = [];

// Store candidate responses
let candidateResponses: Record<string, any> = {};

// Record candidate response
functions.push({
  schema: {
    name: "record_candidate_response",
    type: "function",
    description: "Record the candidate's response to a specific question",
    parameters: {
      type: "object",
      properties: {
        question_id: {
          type: "string",
          description: "The identifier of the question being answered"
        },
        response: {
          type: "string",
          description: "The candidate's response"
        },
        meets_criteria: {
          type: "boolean",
          description: "Whether the response meets the criteria for this question"
        }
      },
      required: ["question_id", "response", "meets_criteria"]
    }
  },
  handler: async (args: { question_id: string; response: string; meets_criteria: boolean }) => {
    candidateResponses[args.question_id] = {
      response: args.response,
      meets_criteria: args.meets_criteria,
      timestamp: new Date().toISOString()
    };
    
    console.log(`Recorded response for question ${args.question_id}: ${args.response}`);
    console.log(`Response meets criteria: ${args.meets_criteria}`);
    
    // Special handling for product experience rejection
    if (args.question_id === "product_experience" && args.meets_criteria === false) {
      console.log("PRODUCT EXPERIENCE REJECTION DETECTED - ENDING CALL");
      
      // Call the hangup endpoint to force disconnect the call
      try {
        const baseUrl = process.env.BASE_URL || "http://localhost:8001";
        fetch(`${baseUrl}/hangup`, {
          method: "POST",
        }).catch(error => {
          console.error("Error calling hangup endpoint:", error);
        });
      } catch (error) {
        console.error("Error calling hangup endpoint:", error);
      }
      
      // Close all connections
      closeAllConnections();
    }
    
    return JSON.stringify({ 
      success: true, 
      message: "Response recorded",
      question_id: args.question_id,
      meets_criteria: args.meets_criteria
    });
  }
});

// Evaluate candidate overall
functions.push({
  schema: {
    name: "evaluate_candidate",
    type: "function",
    description: "Evaluate if the candidate meets all requirements for the position",
    parameters: {
      type: "object",
      properties: {
        overall_assessment: {
          type: "string",
          description: "Overall assessment of the candidate"
        },
        recommend_hire: {
          type: "boolean",
          description: "Whether to recommend hiring this candidate"
        },
        key_strengths: {
          type: "array",
          description: "Key strengths of the candidate"
        },
        concerns: {
          type: "array",
          description: "Potential concerns about the candidate"
        }
      },
      required: ["overall_assessment", "recommend_hire"]
    }
  },
  handler: async (args: { 
    overall_assessment: string; 
    recommend_hire: boolean;
    key_strengths?: string[];
    concerns?: string[];
  }) => {
    console.log(`Candidate evaluation: ${args.overall_assessment}`);
    console.log(`Recommend hire: ${args.recommend_hire}`);
    
    if (args.key_strengths) {
      console.log(`Key strengths: ${args.key_strengths.join(', ')}`);
    }
    
    if (args.concerns) {
      console.log(`Concerns: ${args.concerns.join(', ')}`);
    }
    
    // In a real implementation, this would be stored in a database
    return JSON.stringify({ 
      success: true, 
      message: "Evaluation recorded",
      recommend_hire: args.recommend_hire
    });
  }
});

// Add disconnect_call function
functions.push({
  schema: {
    name: "disconnect_call",
    type: "function",
    description: "Disconnect the current call when candidate doesn't meet requirements",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "The reason for disconnecting the call"
        }
      },
      required: ["reason"]
    }
  },
  handler: async (args: { reason: string }) => {
    console.log(`Call disconnected. Reason: ${args.reason}`);
    
    try {
      // Get the session to access the streamSid
      const session = await import('./callUtils').then(m => m.session);
      
      if (session.streamSid) {
        console.log(`DISCONNECT_CALL FUNCTION: Attempting to end call with SID: ${session.streamSid}`);
        
        // Method 1: Call the hangup endpoint to force disconnect the call
        try {
          console.log("DISCONNECT_CALL FUNCTION: Calling local hangup endpoint");
          const baseUrl = process.env.BASE_URL || "http://localhost:8001";
          await fetch(`${baseUrl}/hangup`, {
            method: "POST",
          });
          console.log("DISCONNECT_CALL FUNCTION: Successfully called hangup endpoint");
        } catch (error) {
          console.error("DISCONNECT_CALL FUNCTION: Error calling hangup endpoint:", error);
        }
        
        // Method 2: Call the Twilio API endpoint directly
        try {
          console.log("DISCONNECT_CALL FUNCTION: Calling Twilio API endpoint");
          const baseUrl = process.env.PUBLIC_URL || "http://localhost:3000";
          const response = await fetch(`${baseUrl}/api/twilio/end-call`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              callSid: session.streamSid,
            }),
          });
          
          if (response.ok) {
            console.log("DISCONNECT_CALL FUNCTION: Successfully ended call via Twilio API");
          } else {
            console.error("DISCONNECT_CALL FUNCTION: Failed to end call via Twilio API");
          }
        } catch (error) {
          console.error("DISCONNECT_CALL FUNCTION: Error calling Twilio API:", error);
        }
        
        // Method 3: Use the endCall function from twilioClient
        try {
          console.log("DISCONNECT_CALL FUNCTION: Using endCall function");
          await endCall(session.streamSid);
          console.log("DISCONNECT_CALL FUNCTION: Successfully called endCall function");
        } catch (error) {
          console.error("DISCONNECT_CALL FUNCTION: Error using endCall function:", error);
        }
      } else {
        console.log("DISCONNECT_CALL FUNCTION: No streamSid available, just closing connections");
      }
      
      // Always close all connections to ensure the call ends
      console.log("DISCONNECT_CALL FUNCTION: Closing all connections");
      closeAllConnections();
    } catch (error) {
      console.error("DISCONNECT_CALL FUNCTION: Error ending call:", error);
      // Ensure connections are closed even if there's an error
      closeAllConnections();
    }
    
    return JSON.stringify({ 
      success: true, 
      message: "Call disconnection completed",
      reason: args.reason
    });
  }
});

functions.push({
  schema: {
    name: "get_weather_from_coords",
    type: "function",
    description: "Get the current weather",
    parameters: {
      type: "object",
      properties: {
        latitude: {
          type: "number",
        },
        longitude: {
          type: "number",
        },
      },
      required: ["latitude", "longitude"],
    },
  },
  handler: async (args: { latitude: number; longitude: number }) => {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m`
    );
    const data = await response.json();
    const currentTemp = data.current?.temperature_2m;
    return JSON.stringify({ temp: currentTemp });
  },
});

export default functions;
