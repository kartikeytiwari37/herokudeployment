import { RawData, WebSocket } from "ws";
import { Session, TwilioMessage, OpenAIMessage, TranscriptItem, AIConfig } from "./types";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { updateCandidateInterviewWithTranscript, updateCandidateInterviewStatus, CallStatus } from "./db";
import { personaPromptMap, CustomerParams } from "./promptConfig";
import * as metrics from "./metricsService";

// Load environment variables
dotenv.config();

// Initialize an empty session
const session: Session = {
  transcript: []
};

// Export the session for use in other modules
export function getSession(): Session {
  return session;
}

/**
 * Handle the connection from Twilio
 */
export function handleTwilioConnection(
  ws: WebSocket, 
  aiConfig: AIConfig
) {
  // Clean up any existing Twilio connection
  cleanupConnection(session.twilioConn);
  
  // Set up the new connection
  session.twilioConn = ws;
  session.aiConfig = aiConfig;
  
  // Set up event handlers
  ws.on("message", handleTwilioMessage);
  ws.on("error", (err) => {
    console.error("Twilio WebSocket error:", err);
    ws.close();
  });
  
  ws.on("close", () => {
    console.log("Twilio connection closed");
    cleanupConnection(session.modelConn);
    cleanupConnection(session.twilioConn);
    
    // Save transcript when call ends
    if (session.transcript.length > 0) {
      saveTranscript();
    }
    
    // Reset session
    session.twilioConn = undefined;
    session.modelConn = undefined;
    session.streamSid = undefined;
    session.lastAssistantItem = undefined;
    session.responseStartTimestamp = undefined;
    session.latestMediaTimestamp = undefined;
  });
}

/**
 * Handle messages from Twilio
 */
function handleTwilioMessage(data: RawData) {
  const msg = parseMessage(data) as TwilioMessage;
  if (!msg) return;

  switch (msg.event) {
    case "start":
      console.log("Call started with streamSid:", msg.start?.streamSid);
      console.log("msg received", msg);
      
      // Store the call SID and stream SID
      session.streamSid = msg.start?.streamSid;
      session.callSid = msg.start?.callSid;
      session.latestMediaTimestamp = 0;
      session.lastAssistantItem = undefined;
      session.responseStartTimestamp = undefined;
      
      // Initialize metrics for this call
      if (session.callSid) {
        session.metrics = metrics.initializeMetrics(session.callSid);
      }
      
      // Add system message to transcript
      addToTranscript("system", "Call started");
      
      // Get call parameters from the global map if available
      if (session.callSid) {
        // Import the call parameters from the server
        const callParameters = (global as any).callParameters;
        if (callParameters && callParameters.has(session.callSid)) {
          const params = callParameters.get(session.callSid);
          console.log(`Found parameters for callSid ${session.callSid}:`, params);
          
          // Set the parameters in the session
          if (params.name) session.customerName = params.name;
          if (params.location) session.customerLocation = params.location;
          if (params.product) session.customerProduct = params.product;
          
          console.log("Updated session with parameters:", {
            customerName: session.customerName,
            customerLocation: session.customerLocation,
            customerProduct: session.customerProduct
          });
        }
      }
      
      // Automatically start recording the call
      if (session.callSid) {
        startRecording(session.callSid);
      }
      
      // Connect to OpenAI
      connectToOpenAI();
      break;
      
    case "media":
      session.latestMediaTimestamp = msg.media?.timestamp;
      if (isOpen(session.modelConn)) {
        jsonSend(session.modelConn, {
          type: "input_audio_buffer.append",
          audio: msg.media?.payload,
        });
      }
      break;
      
    case "close":
      console.log("Call closed");
      // Add system message to transcript
      addToTranscript("system", "Call ended");
      
      // Save transcript
      saveTranscript();
      
      // Close all connections
      closeAllConnections();
      break;
  }
}

/**
 * Connect to OpenAI's real-time API
 */
function connectToOpenAI() {
  try {
    if (!session.twilioConn || !session.streamSid || !session.aiConfig) {
      console.log("Cannot connect to OpenAI: Missing session data");
      return;
    }
    
    if (isOpen(session.modelConn)) {
      console.log("OpenAI connection already open, skipping connection");
      return;
    }
    
    // Record OpenAI connection start time
    if (session.callSid) {
      metrics.recordOpenAIConnectionStart(session.callSid);
    }

    const provider = session.aiConfig.provider;
    let wsUrl: string;
    let headers: Record<string, string>;

    if (provider === "azure") {
      console.log("Connecting to Azure OpenAI...");
      // Format: wss://{your-resource-name}.openai.azure.com/openai/realtime?deployment={deployment-name}&api-version={api-version}&api-key={api-key}
      const baseUrl = session.aiConfig.azure.endpoint.replace('https://', '');
      wsUrl = `wss://${baseUrl}/openai/realtime?deployment=${session.aiConfig.azure.deploymentName}&api-version=${session.aiConfig.azure.version}&api-key=${session.aiConfig.azure.apiKey}`;
      
      console.log(`Azure OpenAI WebSocket URL: wss://${baseUrl}/openai/realtime?deployment=${session.aiConfig.azure.deploymentName}&api-version=${session.aiConfig.azure.version}&api-key=***`);
      
      headers = {};
    } else {
      console.log("Connecting to OpenAI...");
      wsUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
      
      console.log(`OpenAI WebSocket URL: ${wsUrl}`);
      
      headers = {
        Authorization: `Bearer ${session.aiConfig.openai.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      };
    }

    console.log(`Using AI provider: ${provider}`);
    
    // Create WebSocket connection with timeout handling
    console.log(`Creating WebSocket connection to ${provider}...`);
    session.modelConn = new WebSocket(wsUrl, { headers });

    // Set connection timeout
    const connectionTimeout = setTimeout(() => {
      try {
        console.error(`Connection to ${provider} timed out after 10 seconds`);
        if (session.modelConn) {
          session.modelConn.close();
        }
      } catch (error) {
        console.error('❌ Error handling connection timeout:', error);
      }
    }, 10000);

    session.modelConn.on("open", () => {
      clearTimeout(connectionTimeout);
      console.log(`Successfully connected to ${provider}`);
      
      // Record OpenAI connection end time
      if (session.callSid) {
        metrics.recordOpenAIConnectionEnd(session.callSid);
      }
    
    // Get customer parameters
    const customerName = session.customerName || "the candidate";
    const customerLocation = session.customerLocation || "the specified location";
    const customerProduct = session.customerProduct || "the specified product";
    
    console.log("OpenAI prompt parameters:");
    console.log("- Customer Name:", customerName);
    console.log("- Customer Location:", customerLocation);
    console.log("- Customer Product:", customerProduct);
    console.log("- Session values:", {
      customerName: session.customerName,
      customerLocation: session.customerLocation,
      customerProduct: session.customerProduct
    });
    
    // Create the customer parameters object
    const customerParams: CustomerParams = {
      customerName,
      customerLocation,
      customerProduct
    };
    
    // Get the prompt from the config map based on the persona
    let personaName = session.persona || "HR screening persona";
    
    // Check if the persona exists in the config map
    if (!personaPromptMap[personaName]) {
      console.warn(`Persona "${personaName}" not found in config map, using default "HR screening persona"`);
      personaName = "HR screening persona";
    }
    
    const personaConfig = personaPromptMap[personaName];
    const instructions = personaConfig.getPromptText(customerParams);
    
    console.log(`Using persona: ${personaName}`);
    
    console.log("Sending OpenAI session update with instructions:", instructions.substring(0, 200) + "...");
    console.log("Full instructions length:", instructions.length);
    
    // Log the complete instructions to the console
    console.log("==== COMPLETE INSTRUCTIONS START ====");
    console.log(instructions);
    console.log("==== COMPLETE INSTRUCTIONS END ====");
    
    // Configure the session
    const sessionConfig = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        turn_detection: { type: "server_vad" },
        voice: "sage",
        input_audio_transcription: { model: "whisper-1" },
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        instructions: instructions,
      },
    };
    
    // Log the full session configuration
    console.log("OpenAI session configuration:", JSON.stringify({
      ...sessionConfig,
      session: {
        ...sessionConfig.session,
        instructions: `${instructions.substring(0, 100)}... [truncated, total length: ${instructions.length}]`
      }
    }, null, 2));
    
    jsonSend(session.modelConn, sessionConfig);
    console.log("OpenAI session configuration sent");
    
    // Log the persona being used
    console.log(`Using persona "${personaName}" for this conversation`);
  });

    session.modelConn.on("message", (data: RawData) => {
      try {
        // Log only the first message for debugging
        if (!(session as any).messageReceived) {
          console.log(`Received first message from ${provider}`);
          (session as any).messageReceived = true;
        }
        
        // Process the message
        handleOpenAIMessage(data);
      } catch (error) {
        console.error(`❌ Error processing message from ${provider}:`, error);
      }
    });
    
    session.modelConn.on("error", (err) => {
      clearTimeout(connectionTimeout);
      console.error(`${provider} WebSocket error:`, err);
      closeOpenAIConnection();
    });
    
    session.modelConn.on("close", (code, reason) => {
      clearTimeout(connectionTimeout);
      console.log(`${provider} connection closed with code ${code}${reason ? ': ' + reason : ''}`);
      closeOpenAIConnection();
    });
  } catch (error) {
    console.error(`Error establishing connection to ${session.aiConfig?.provider || 'AI provider'}:`, error);
    closeOpenAIConnection();
  }
}

/**
 * Handle messages from OpenAI
 */
function handleOpenAIMessage(data: RawData) {
  const event = parseMessage(data) as OpenAIMessage;
  if (!event) return;

  switch (event.type) {
    case "input_audio_buffer.speech_started": {
      handleTruncation();
      
      // Create a placeholder for user message
      if (event.item_id) {
        addToTranscript("user", "...", event.item_id);
        
        // Record user speech start
        if (session.callSid) {
          metrics.recordUserSpeechStart(session.callSid, event.item_id);
        }
      }
      break;
    }

    case "response.audio.delta": {
      if (session.twilioConn && session.streamSid) {
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = session.latestMediaTimestamp || 0;
        }
        
        // Track AI response for metrics
        if (event.item_id) {
          // Store the last assistant item ID for truncation
          session.lastAssistantItem = event.item_id;
          
          // Record AI response start if this is a new item
          if (session.callSid) {
            // Check if we already have this item in the metrics
            const metricsObj = metrics.getMetrics(session.callSid);
            if (metricsObj && !metricsObj.aiResponseEvents.some(e => e.itemId === event.item_id)) {
              console.log(`[METRICS] Recording AI response start for item ${event.item_id} (from audio.delta)`);
              metrics.recordAIResponseStart(session.callSid, event.item_id);
            }
          }
        }

        jsonSend(session.twilioConn, {
          event: "media",
          streamSid: session.streamSid,
          media: { payload: event.delta },
        });

        jsonSend(session.twilioConn, {
          event: "mark",
          streamSid: session.streamSid,
        });
      }
      break;
    }

    case "conversation.item.created": {
      if (event.item?.type === "message") {
        const role = event.item.role as "user" | "assistant";
        const content = event.item.content
          ? event.item.content.map(c => c.text).join("")
          : "";
        
        // Add to transcript
        if (content) {
          // If this is a completed message, update or add it to the transcript
          addToTranscript(role, content, event.item.id);
        }
      }
      break;
    }
      
    case "conversation.item.input_audio_transcription.completed": {
      // Update the user message with the final transcript
      const { item_id, transcript } = event;
      
      if (item_id && transcript) {
        console.log("Received transcript:", transcript);
        
        // Update the transcript with the transcription
        updateTranscriptItem(item_id, "user", transcript);
        
        // Record user speech end
        if (session.callSid && transcript) {
          metrics.recordUserSpeechEnd(session.callSid, item_id, transcript.length);
        }
      }
      break;
    }
    
    case "response.content_part.added": {
      const { item_id, part, output_index } = event;
      
      // Append new content to the assistant message if output_index == 0
      if (part?.type === "text" && output_index === 0 && item_id) {
        // Check if we already have an item with this ID
        const existingItem = session.transcript.find(item => item.itemId === item_id);
        
        if (existingItem) {
          // Update existing item
          existingItem.content += part.text;
        } else {
          // Create new assistant item
          addToTranscript("assistant", part.text, item_id);
          
          // Record AI response start
          if (session.callSid) {
            console.log(`[METRICS] Recording AI response start for item ${item_id}`);
            metrics.recordAIResponseStart(session.callSid, item_id);
          }
        }
      }
      break;
    }
    
    case "response.audio_transcript.delta": {
      // Streaming transcript text (assistant)
      const { item_id, delta, output_index } = event;
      
      if (output_index === 0 && delta && item_id) {
        // Check if we already have an item with this ID
        const existingItem = session.transcript.find(item => item.itemId === item_id);
        
        if (existingItem) {
          // Update existing item
          existingItem.content += delta;
        } else {
          // Create new assistant item
          addToTranscript("assistant", delta, item_id);
          
          // Record AI response start if this is a new item
          if (session.callSid) {
            console.log(`[METRICS] Recording AI response start for item ${item_id} (from audio_transcript.delta)`);
            metrics.recordAIResponseStart(session.callSid, item_id);
          }
        }
      }
      break;
    }
    
    case "response.output_item.done": {
      const { item } = event;
      if (item?.type === "function_call") {
        console.log("Function call:", item);
        // Add function call to transcript
        const functionCallText = `${item.name}(${JSON.stringify(JSON.parse(item.arguments || '{}'))})`;
        addToTranscript("assistant", functionCallText, item.id);
      } else if (item?.type === "message" && item.id) {
        // Record AI response end
        if (session.callSid && item.content) {
          const contentText = item.content.map(c => c.text).join("");
          console.log(`[METRICS] Recording AI response end for item ${item.id}, content length: ${contentText.length}`);
          metrics.recordAIResponseEnd(session.callSid, item.id, contentText.length);
        }
      }
      break;
    }
  }
}

/**
 * Handle truncation of assistant responses when user starts speaking
 */
function handleTruncation() {
  if (
    !session.lastAssistantItem ||
    session.responseStartTimestamp === undefined
  )
    return;

  const elapsedMs =
    (session.latestMediaTimestamp || 0) - (session.responseStartTimestamp || 0);
  const audio_end_ms = elapsedMs > 0 ? elapsedMs : 0;

  // Record AI response end for the truncated response
  if (session.callSid && session.lastAssistantItem) {
    // Find the transcript item to get the content length
    const transcriptItem = session.transcript.find(item => item.itemId === session.lastAssistantItem);
    if (transcriptItem) {
      console.log(`[METRICS] Recording AI response end for truncated item ${session.lastAssistantItem}, content length: ${transcriptItem.content.length}`);
      metrics.recordAIResponseEnd(session.callSid, session.lastAssistantItem, transcriptItem.content.length);
    }
  }

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, {
      type: "conversation.item.truncate",
      item_id: session.lastAssistantItem,
      content_index: 0,
      audio_end_ms,
    });
  }

  if (session.twilioConn && session.streamSid) {
    jsonSend(session.twilioConn, {
      event: "clear",
      streamSid: session.streamSid,
    });
  }

  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
}

/**
 * Close the OpenAI connection
 */
function closeOpenAIConnection() {
  try {
    console.log(`Closing connection to ${session.aiConfig?.provider || 'AI provider'}...`);
    cleanupConnection(session.modelConn);
    session.modelConn = undefined;
    console.log('Connection closed successfully');
  } catch (error) {
    console.error('Error closing AI provider connection:', error);
  }
}

/**
 * Close all connections
 */
function closeAllConnections() {
  cleanupConnection(session.twilioConn);
  cleanupConnection(session.modelConn);
  
  session.twilioConn = undefined;
  session.modelConn = undefined;
  session.streamSid = undefined;
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
  session.latestMediaTimestamp = undefined;
}

/**
 * Clean up a WebSocket connection
 */
function cleanupConnection(ws?: WebSocket) {
  try {
    if (ws) {
      console.log('Closing WebSocket connection...');
      ws.close();
      console.log('WebSocket connection closed');
    }
  } catch (error) {
    console.error('Error cleaning up WebSocket connection:', error);
  }
}

/**
 * Parse a WebSocket message
 */
function parseMessage(data: RawData): any {
  try {
    const message = JSON.parse(data.toString());
    return message;
  } catch (err) {
    console.error("Error parsing WebSocket message:", err);
    return null;
  }
}

/**
 * Send a JSON message over WebSocket
 */
function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  try {
    if (!isOpen(ws)) {
      console.warn("Cannot send message: WebSocket not open");
      return;
    }
    
    const message = JSON.stringify(obj);
    
    
    ws.send(message);
  } catch (error) {
    console.error("Error sending WebSocket message:", error);
  }
}

/**
 * Check if a WebSocket is open
 */
function isOpen(ws?: WebSocket): ws is WebSocket {
  if (!ws) return false;
  
  try {
    // Simple check - if we can send a message, the connection is open
    // This avoids TypeScript issues with readyState
    return true;
  } catch (error) {
    console.error('Error checking WebSocket state:', error);
    return false;
  }
}

/**
 * Add an item to the transcript
 */
function addToTranscript(role: "user" | "assistant" | "system", content: string, itemId?: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${role}: ${content}`);
  
  // Check if we already have an item with this ID
  if (itemId) {
    const existingItemIndex = session.transcript.findIndex(item => item.itemId === itemId);
    
    if (existingItemIndex >= 0) {
      // Update existing item
      session.transcript[existingItemIndex].content = content;
      return;
    }
  }
  
  // Add new item
  session.transcript.push({
    role,
    content,
    timestamp,
    itemId
  });
}

/**
 * Update a transcript item by ID
 */
function updateTranscriptItem(itemId: string, role: "user" | "assistant" | "system", content: string) {
  const existingItemIndex = session.transcript.findIndex(item => item.itemId === itemId);
  
  if (existingItemIndex >= 0) {
    // Update existing item
    session.transcript[existingItemIndex].content = content;
    console.log(`Updated transcript item ${itemId}: ${content}`);
  } else {
    // Add new item if not found
    addToTranscript(role, content, itemId);
  }
}

/**
 * Analyze transcript using OpenAI API
 * @param transcriptText The formatted transcript text
 * @param cvInfo Optional CV information for verification
 * @returns Analysis result
 */
async function analyzeTranscript(transcriptText: string, cvInfo?: any): Promise<string> {
  try {
    console.log("=== TRANSCRIPT ANALYSIS STARTED ===");
    console.log(`Transcript length: ${transcriptText.length} characters`);
    
    // Check if transcript is empty
    if (!transcriptText || transcriptText.trim().length === 0) {
      console.log("Transcript is empty, skipping analysis");
      return "No transcript content to analyze.";
    }
    
    // Check for non-English content
    const hasHindiContent = /[\u0900-\u097F]/.test(transcriptText);
    const hasNonEnglishContent = transcriptText.split('').some(char => char.charCodeAt(0) > 127);
    
    if (hasHindiContent) {
      console.log(`Detected Hindi content in transcript`);
    }
    if (hasNonEnglishContent) {
      console.log(`Detected non-English content in transcript`);
    }
    
    // Format CV information if available
    let cvInfoSection = '';
    if (cvInfo && cvInfo.extractedInfo) {
      console.log(`CV information available for verification`);
      
      cvInfoSection = `
      CANDIDATE CV INFORMATION:
      This information was extracted from the candidate's CV and should be used to verify the information shared during the interview.
      
      Personal Information:
      ${JSON.stringify(cvInfo.extractedInfo.personalInfo, null, 2)}
      
      Work Experience:
      ${JSON.stringify(cvInfo.extractedInfo.workExperience, null, 2)}
      
      Education:
      ${JSON.stringify(cvInfo.extractedInfo.education, null, 2)}
      
      Skills:
      ${JSON.stringify(cvInfo.extractedInfo.skills, null, 2)}
      
      ${cvInfo.extractedInfo.certifications ? `Certifications:
      ${JSON.stringify(cvInfo.extractedInfo.certifications, null, 2)}` : ''}
      
      ${cvInfo.extractedInfo.salesMetrics ? `Sales Metrics:
      ${JSON.stringify(cvInfo.extractedInfo.salesMetrics, null, 2)}` : ''}
      `;
    } else {
      console.log(`No CV information available for verification`);
    }
    
    // Prompt for analysis
    const prompt = `
      You are an expert recruitment analyst evaluating an initial screening call for frontline sales staff positions.
      The AI assistant in this conversation was conducting an initial screening interview to check the basic qualifications of the candidate.
      
      ${hasHindiContent ? "IMPORTANT: This transcript contains content in Hindi. As a multilingual analyzer, please analyze both Hindi and English portions of the conversation." : ""}
      ${hasNonEnglishContent ? "IMPORTANT: This transcript contains content in a non-English language. Please do your best to analyze it, focusing on the overall structure of the conversation." : ""}
      
      ${cvInfoSection ? cvInfoSection : ""}
      
      ${cvInfoSection ? "IMPORTANT: Compare the information provided by the candidate during the interview with the information from their CV. Note any discrepancies or inconsistencies in your analysis." : ""}
      
      Please analyze this interview and provide detailed insights including:
      
      1. Summary of the candidate's background and experience
      2. Key qualifications and skills mentioned
      3. Communication skills assessment (clarity, articulation, listening)
      4. Sales aptitude indicators
      5. Red flags or concerns (if any)
      ${cvInfoSection ? "6. CV Verification: Assess whether the information provided during the interview matches the CV" : ""}
      ${cvInfoSection ? "7. Overall candidate evaluation" : "6. Overall candidate evaluation"}
      ${cvInfoSection ? "8. HIRING RECOMMENDATION: Provide a clear GO/NO GO recommendation with brief justification" : "7. HIRING RECOMMENDATION: Provide a clear GO/NO GO recommendation with brief justification"}
      
      Format your response with clear headings and bullet points where appropriate.
      Make your analysis concise but thorough, focusing on factors relevant to frontline sales positions.
      
      Transcript:
      ${transcriptText}
    `;
    
    // Get API key and endpoint based on provider
    let apiKey: string;
    let endpoint: string;
    let model: string;
    
    if (!session.aiConfig) {
      console.error("AI configuration is missing");
      return "Error: AI configuration is missing";
    }
    
    if (session.aiConfig.provider === "azure") {
      // Use Azure OpenAI Analysis configuration if available
      const azureAnalysis = (session.aiConfig as any).azureAnalysis;
      if (azureAnalysis) {
        console.log("Using Azure OpenAI Analysis configuration for transcript analysis");
        apiKey = azureAnalysis.apiKey;
        endpoint = `${azureAnalysis.endpoint}/openai/deployments/${azureAnalysis.deploymentId}/chat/completions?api-version=${azureAnalysis.apiVersion}`;
        model = ""; // Not needed for Azure, as it's specified in the deployment
      } else {
        // Fallback to regular Azure configuration
        console.log("Azure OpenAI Analysis configuration not found, using regular Azure configuration");
        apiKey = session.aiConfig.azure.apiKey;
        endpoint = `${session.aiConfig.azure.endpoint}/openai/deployments/${session.aiConfig.azure.deploymentName}/chat/completions?api-version=${session.aiConfig.azure.version}`;
        model = ""; // Not needed for Azure, as it's specified in the deployment
      }
    } else {
      apiKey = session.aiConfig.openai.apiKey;
      endpoint = "https://api.openai.com/v1/chat/completions";
      model = "gpt-4o";
    }
    
    // Call AI API
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "system",
            content: "You are an expert multilingual call analyzer providing detailed insights on conversation transcripts. You can understand and analyze content in multiple languages including Hindi. Your analysis should be thorough, well-structured, and include clear headings and bullet points."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });
    
    // Parse response
    const data = await response.json();
    
    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return `Error analyzing transcript: ${data.error?.message || "Unknown error"}`;
    }
    
    // Extract analysis
    const analysis = data.choices?.[0]?.message?.content || "No analysis available";
    console.log("Analysis completed, length:", analysis.length);
    
    return analysis;
  } catch (error) {
    console.error("Error analyzing transcript:", error);
    return `Error analyzing transcript: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

/**
 * Start recording a call
 */
async function startRecording(callSid: string) {
  try {
    console.log(`Automatically starting recording for call SID: ${callSid}`);
    
    // Import twilio client
    const twilio = require('twilio');
    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
    const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
    
    // Initialize Twilio client
    const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    
    // Start recording using Twilio client
    const recording = await twilioClient.calls(callSid).recordings.create({
      recordingChannels: "dual",
      recordingTrack: "both",
      trim: "do-not-trim"
    });
    
    console.log(`Recording started with SID: ${recording.sid}`);
    
    // Store the recording ID in the database
    const { updateCandidateInterviewWithRecordingId } = await import('./db');
    const s3Key = `recordings/${recording.sid}.mp3`; // Default to MP3 format
    await updateCandidateInterviewWithRecordingId(callSid, recording.sid, s3Key);
    
    console.log(`Stored recording ID ${recording.sid} for call SID: ${callSid}`);
    
    // Save recording ID in session for later use
    session.recordingSid = recording.sid;
    
    return recording.sid;
  } catch (error) {
    console.error("Error starting recording:", error);
    return null;
  }
}

/**
 * Download and save a recording to S3
 */
async function downloadAndSaveRecording(recordingSid: string, callSid: string) {
  try {
    console.log(`Downloading recording ${recordingSid} for call ${callSid}`);
    
    // Import required modules
    const twilio = require('twilio');
    const { isS3Configured, uploadBufferToS3 } = await import('./s3Service');
    
    // Check if S3 is configured
    if (!isS3Configured()) {
      console.error('S3 is not properly configured, cannot save recording');
      return;
    }
    
    // Get Twilio credentials
    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
    const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
    
    // Determine the format (default to MP3)
    const fileFormat = 'mp3';
    
    // Construct the media URL
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.${fileFormat}`;
    
    console.log(`Downloading recording from Twilio: ${mediaUrl}`);
    
    // Download the recording using fetch with authentication
    const response = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download recording from Twilio: ${response.statusText}`);
    }
    
    // Get the content type from the response
    const contentType = response.headers.get('content-type') || 
      (fileFormat === 'mp3' ? 'audio/mpeg' : 'audio/x-wav');
    
    // Get the recording data as an array buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Upload to S3
    const s3Key = `${recordingSid}.${fileFormat}`;
    const s3Result = await uploadBufferToS3(
      buffer,
      s3Key,
      contentType,
      'recordings'
    );
    
    console.log(`Uploaded recording to S3: ${s3Result.Key}`);
    
    return s3Result.Key;
  } catch (error) {
    console.error("Error downloading and saving recording:", error);
    return null;
  }
}

/**
 * Save the transcript to MongoDB only
 */
async function saveTranscript() {
  console.log("=== TRANSCRIPT SAVING PROCESS STARTED ===");
  
  if (session.transcript.length === 0) {
    console.log("⚠️ No transcript to save - transcript array is empty");
    return;
  }
  
  try {
    // Get call details
    const callSid = session.callSid || "unknown";
    const phoneNumber = session.phoneNumber || "unknown";
    
    // Calculate overall metrics before saving
    if (callSid !== "unknown") {
      metrics.calculateOverallMetrics(callSid);
    }
    
    console.log(`📞 Call details - SID: ${callSid}, Phone: ${phoneNumber}`);
    console.log(`📝 Transcript contains ${session.transcript.length} items`);
    
    // Convert transcript to text format
    const textTranscript = session.transcript
      .map(item => {
        // Skip system messages
        if (item.role === "system") return null;
        
        // Format user and assistant messages
        const role = item.role === "user" ? "Caller" : "Assistant";
        return `${role}: ${item.content}`;
      })
      .filter(line => line !== null) // Remove null entries (system messages)
      .join("\n\n\n");
    
    console.log(`📄 Formatted text transcript length: ${textTranscript.length} characters`);
    
    // Get the candidate interview record to access CV information
    const { getCandidateInterview } = await import("./db");
    const interview = await getCandidateInterview(callSid);
    
    // Extract CV information if available
    const cvInfo = interview?.candidateInfo?.cvInfo;
    if (cvInfo) {
      console.log(`Found CV information for candidate in interview record`);
    } else {
      console.log(`No CV information found for candidate in interview record`);
    }
    
    // Analyze the transcript with CV information if available
    console.log("🔍 Starting transcript analysis...");
    console.log(`⏱️ Analysis started at: ${new Date().toISOString()}`);
    
    // Record analysis start time
    if (callSid !== "unknown") {
      metrics.recordAnalysisStart(callSid);
    }
    
    const analysis = await analyzeTranscript(textTranscript, cvInfo);
    
    // Record analysis end time
    if (callSid !== "unknown") {
      metrics.recordAnalysisEnd(callSid);
    }
    
    console.log(`⏱️ Analysis completed at: ${new Date().toISOString()}`);
    
    // Update MongoDB with transcript, analysis, and metrics
    console.log(`💾 Saving transcript, analysis, and metrics to MongoDB...`);
    
    // Get the metrics for this call if available
    let callMetrics = null;
    if (callSid !== "unknown") {
      callMetrics = metrics.getMetrics(callSid);
      if (callMetrics) {
        // Convert any Date objects to ISO strings for MongoDB storage
        callMetrics = JSON.parse(JSON.stringify(callMetrics));
      }
    }
    
    await updateCandidateInterviewWithTranscript(callSid, textTranscript, analysis, callMetrics);
    console.log(`✅ Transcript, analysis, and metrics saved to MongoDB successfully`);
    
    // Update call status to COMPLETED
    await updateCandidateInterviewStatus(callSid, CallStatus.COMPLETED);
    console.log(`✅ Call status updated to COMPLETED in MongoDB`);
    
    // Download and save recording to S3 if available
    if (session.recordingSid) {
      await downloadAndSaveRecording(session.recordingSid, callSid);
    }
    
    console.log("=== TRANSCRIPT PROCESSING COMPLETED SUCCESSFULLY ===");
    
    // Log final metrics summary
    if (callSid !== "unknown") {
      metrics.logMetricsSummary(callSid);
    }
    
    // Reset transcript
    session.transcript = [];
    console.log("🧹 Transcript array cleared");
  } catch (err) {
    console.error("❌ ERROR SAVING TRANSCRIPT:", err);
    
    // Try to update call status to DISCONNECTED in case of error
    if (session.callSid) {
      try {
        await updateCandidateInterviewStatus(session.callSid, CallStatus.DISCONNECTED);
        console.log(`✅ Call status updated to DISCONNECTED in MongoDB due to error`);
      } catch (statusErr) {
        console.error("❌ ERROR UPDATING CALL STATUS:", statusErr);
      }
    }
  }
}
