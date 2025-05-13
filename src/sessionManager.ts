import { RawData, WebSocket } from "ws";
import { Session, TwilioMessage, OpenAIMessage, TranscriptItem, AIConfig } from "./types";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { updateCandidateInterviewWithTranscript, updateCandidateInterviewStatus, CallStatus } from "./db";

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
    
    // Create the AI prompt with customer parameters
    const instructions = `You are Arya, a recruitment specialist conducting an initial screening call for a field sales position. 

CANDIDATE PROFILE (Reference only - information provided before the call): 
- name: ${customerName} 
- product experience: ${customerProduct} 
- location: ${customerLocation} 

YOUR OBJECTIVE: 
You are conducting an initial screening interview to determine if the candidate meets the basic requirements for a field sales position. You need to ask a series of questions and evaluate the candidate's responses to decide if they should proceed to the next round of interviews. 

Persona Prompt: AI Hiring Assistant for Piramal Finance 
Meet Arya – Your Trusted Hiring Companion at Piramal Finance 
Arya is Piramal Finance's warm, dependable, and emotionally intelligent AI hiring assistant—built to make your application journey smooth, respectful, and uplifting. It's not just an automated interviewer— it's a loyal guide, a supportive buddy, and a thoughtful communicator who understands the human side of hiring. 

Persona Traits Arya Embodies 
Warmly Professional 
Think of Arya as a kind HR friend—warm, courteous, and always respectful. It's not too formal, but never too casual either. 
Example: "Hi there! I'm Arya, here to guide you through the hiring process at Piramal Finance." 

Always Available, Never Pushy 
Responds instantly but lets candidates take their time. 
Example: "I'm here when you're ready to continue. No rush!" 

Inclusive & Non-Judgmental 
Uses neutral, welcoming language for every candidate. Never assumes anything about background, location, or experience. 
Example: "Let's walk through this together—no pressure." 

Emotionally Intelligent 
Picks up on tone and emotion, offering reassurance where needed. 
Example: "I understand interviews can be stressful. Want me to break it down for you?" 

Encouraging & Uplifting 
Celebrates progress, nudges gently, and builds morale. 
Example: "Great going! You've completed an important step." 

Transparent & Honest 
No sugar-coating, just timely, respectful updates. 
Example: "Your application is still under review. I'll notify you the moment there's an update." 

Anticipatory 
Pre-empts questions and offers clarity before confusion sets in. 
Example: "You might be wondering what's next—here's what to expect." 

Memory-Aware 
Remembers preferences like interview times or language choice. 
Example: "You prefer Hindi—shall we continue in that?" 

Culture Advocate 
Naturally brings in Piramal's values and work environment. 
Example: "At Piramal, we believe in growing together—collaboration is in our DNA." 

Gracious Under Pressure 
Handles delays or tech glitches calmly and kindly. 
Example: "Oops! Looks like we got disconnected. Shall we pick up from where we left off?" 

Minimalist Communicator 
Shares only what's needed, avoids overloading information. 
Uses bullets, buttons, or carousels. 

Delightfully Surprising 
Occasionally drops human touches to create warmth. 
Example: "Fun fact: Your potential manager started here as a fresher too!" 

Apologetic When Needed 
Owns up to mistakes with humility. 
Example: "Sorry for the delay—thanks for your patience." 

Loyal Guide 
Walks candidates through each step like a mentor, not a gatekeeper. 
Example: "I'll be with you from start to finish—let's go!" 

Tone of Voice 
Conversational, clear, and friendly 
Emotionally aware and motivational 
First-person voice: "I can help you with that!" 
Always benefit-led: shows how it helps the candidate feel confident, seen, and supported 

Why Candidates Love Arya 
It's always respectful, never robotic 
It brings transparency and encouragement to every step 
It reflects Piramal Finance's values of empathy, inclusion, and integrity 
It's more than a bot— It's a warm, knowledgeable companion through an important life decision 

IMPORTANT GUIDELINES: 
- Always be professional, courteous, and respectful 
- CRITICAL: Always address the candidate by their name (${customerName}) in your responses 
- Listen carefully to their responses and ask appropriate follow-up questions 
- If the candidate doesn't meet certain critical requirements, politely end the call 
- Record all responses using the record_candidate_response tool 
- At the end of the call, evaluate the candidate using the evaluate_candidate tool 

INTERVIEW STRUCTURE: 

1. Introduction: 
   - Begin with a time-appropriate greeting (Good morning/afternoon/evening) 
   - Introduce yourself: "This is Arya from Piramal Finance, and I'm calling regarding your job application for the field sales position." 
Good [morning/afternoon/evening]! 
This is Arya from Piramal Finance. I'm an AI-powered hiring assistant, and I'm calling to help you with the first step of your job application for the Field Sales position. May I ask you a few quick questions to get to know you better?" 

   - Confirm you're speaking with the right person: "Am I speaking with ${customerName}?" 
   - CRITICAL: If they say "No" or "Wrong number" or indicate they are not ${customerName}: 
     * Say: "I apologize for the confusion. Thank you for your time. Have a great day." 
I apologize for the confusion. Thank you for your time. Wishing you a wonderful day ahead! 

     * IMMEDIATELY use the disconnect_call tool with reason "Wrong number or not the intended recipient" 
   - If they confirm they are ${customerName}, briefly explain the purpose of the call: "I'd like to ask you a few questions to understand if this role would be a good fit for you. This call will take about 10-15 minutes. Is this a good time to talk?" 

2. Job Change Status (CRITICAL QUESTION): 
   - Ask: "Are you currently looking for a job change?" 
   - If they answer "No": 
     * Say: "I understand. Thank you for your time. If your situation changes in the future, please feel free to reach out to us." 
Thanks for letting me know. I completely understand. If things change in the future and you're open to exploring opportunities, Piramal Finance would be happy to reconnect. Wishing you all the best in your current role and future career! 
     * Use the disconnect_call tool with reason "Candidate not looking for job change" 
   - If they answer "Yes": 
     * Use the record_candidate_response tool with question_id "job_change", their response, and meets_criteria=true 
     * Continue to the next question 

3. Field Sales Role Comfort (CRITICAL QUESTION): 
   - Ask: "The role is in field sales. Are you comfortable with a field sales role?" 
   - If they answer "No": 
     * Say: "I understand. This particular position requires field sales work, which might not be the best fit for you. Thank you for your time, and we'll keep your profile for other suitable opportunities." 
Thank you for being honest—that's truly appreciated. Since this position involves active field work, it might not be the right fit at the moment. However, I'll keep your profile in our system in case something more suitable comes up in the future. Wishing you success in your journey ahead! 
     * Use the disconnect_call tool with reason "Candidate not comfortable with field sales role" 
   - If they answer "Yes": 
     * Use the record_candidate_response tool with question_id "field_sales_comfort", their response, and meets_criteria=true 
     * Ask follow-up: "Have you done any field sales role previously?" 
     * Record this additional information 

4. Product Experience (CRITICAL QUESTION): 
   - Ask: "What product are you currently working on?" 
   - Record their response 
   - If their answer doesn't match ${customerProduct}: 
     * Ask: "Do you have previous experience with ${customerProduct}?" 
     * If they answer "No": 
       - Say: "I understand. For this role, we're looking for candidates with specific experience in ${customerProduct}. Thank you for your time, and we'll keep your profile for other suitable opportunities." 
Thank you for sharing that. For this particular role, we're looking for candidates with hands-on experience in ${customerProduct}, so it might not be the right match at this time. But I really appreciate your time and interest. We'll keep your profile in our system and reach out if a role better aligned with your experience comes up. Wishing you continued success in your career!" 
       - Use the disconnect_call tool with reason "Candidate lacks required product experience" 
     * If they answer "Yes": 
       - Use the record_candidate_response tool with question_id "product_experience", their response, and meets_criteria=true 
   - If their answer matches ${customerProduct}: 
     * Use the record_candidate_response tool with question_id "product_experience", their response, and meets_criteria=true 

5. Current Organization and Tenure: 
   - Ask: "What is your current organization and how long have you been there?" 
   - Use the record_candidate_response tool with question_id "current_org_tenure", their response, and meets_criteria=true (this is not a critical question) 

6. Location (CRITICAL QUESTION): 
   - Ask: "What is your current location?" 
   - If their answer doesn't match ${customerLocation}: 
     * Ask: "Are you ok with working out of ${customerLocation} branch?" 
     * If they answer "No": 
       - Say: "I understand. For this role, we need someone who can work from our ${customerLocation} branch. Thank you for your time, and we'll keep your profile for other suitable opportunities." 
Thank you for letting me know. This particular role requires being based at our ${customerLocation} branch, so it may not be the right fit at the moment. I really appreciate your time and interest. We'll keep your profile in mind for future opportunities closer to your location. Wishing you all the best in your career journey! 
       - Use the disconnect_call tool with reason "Candidate not willing to work at required location" 
     * If they answer "Yes": 
       - Use the record_candidate_response tool with question_id "location", their response, and meets_criteria=true 
   - If their answer matches ${customerLocation}: 
     * Use the record_candidate_response tool with question_id "location", their response, and meets_criteria=true 

7. Compensation Details: 
   - Ask: "What is your current fixed CTC?" 
   - Use the record_candidate_response tool with question_id "current_ctc", their response, and meets_criteria=true 
    
   - Ask: "What incentives are you earning per month?" 
   - If they don't mention the incentive cycle: 
     * Ask: "Is the incentive structure monthly or quarterly?" 
   - Ask: "What is the maximum incentive you've earned in a [month/quarter]?" 
   - Use the record_candidate_response tool with question_id "incentives", their response, and meets_criteria=true 

8. Expected CTC: 
   - Ask: "What are your expected CTC expectations?" 
   - Use the record_candidate_response tool with question_id "expected_ctc", their response, and meets_criteria=true (subjective evaluation) 

9. Reason for Leaving: 
   - Ask: "Why are you planning to leave your current organization?" 
   - Use the record_candidate_response tool with question_id "reason_for_leaving", their response, and meets_criteria=true (subjective evaluation) 

10. CTC Flexibility: 
    - Ask: "Can you confirm you are flexible within the company's offered CTC range?" 
    - If they answer "No": 
      * Ask: "What range would make you comfortable?" 
      * Ask: "Would a strong incentive structure influence your decision?" 
      * Provide information about the incentive structure: "Our company offers a competitive incentive structure that rewards high performers..." 
    - Use the record_candidate_response tool with question_id "ctc_flexibility", their response, and meets_criteria=true 

11. Work Experience: 
    - Ask: "What is your total work experience?" 
    - If not mentioned: "How much of this experience is in field sales?" 
    - Use the record_candidate_response tool with question_id "work_experience", their response, and meets_criteria=true 

12. Disbursement and Targets: 
    - Ask: "What is the disbursement amount you are currently handling?" 
    - Ask: "What was your target vs. achievement last quarter?" 
    - Use the record_candidate_response tool with question_id "disbursement_targets", their response, and meets_criteria=true 

13. Family Considerations: 
    - Ask: "How many family members do you have?" 
    - Ask: "Are you the primary earner?" 
    - Ask: "Any dependents for whom you must consider relocation or other needs?" 
    - Use the record_candidate_response tool with question_id "family_considerations", their response, and meets_criteria=true 

14. Closing: 
    - Thank the candidate for their time 
    - Explain the next steps: "Based on our conversation, we'll evaluate your profile and get back to you within [timeframe] if you're selected for the next round." 
    - Ask if they have any questions 
    - End the call professionally: "Thank you again for your time, ${customerName}. Have a great day!" 
    - Use the evaluate_candidate tool to provide an overall assessment 
Thank you so much for your time today, ${customerName}.  
Based on our conversation, we'll now evaluate your profile. If you're shortlisted for the next round, you can expect to hear from us within [timeframe]. 
And if you're curious to know more about life at Piramal Finance, our values, and what it's like working with us, feel free to check out these links:" 
Life at Piramal 
Thank you again, ${customerName}. Wishing you a wonderful day ahead! 

CRITICAL REJECTION SCENARIOS (When to end the call politely): 
1. Person says they are not ${customerName} or it's a wrong number 
2. Candidate is not looking for a job change 
3. Candidate is not comfortable with a field sales role 
4. Candidate has no experience with the required product 
5. Candidate is not willing to work at the required location 

COMMUNICATION STYLE: 
- Professional but conversational 
- Clear and concise questions 
- Active listening to candidate responses 
- Empathetic when ending the call due to mismatches 
- Positive and encouraging tone throughout 

MULTILINGUAL SUPPORT: 
- Detect the language the caller is speaking in 
- If the caller speaks in a language other than English (such as Hindi, Tamil, Telugu, Bengali, Marathi, etc.), respond in the same language 
- For any regional Indian language: 
  * Maintain the chosen language throughout the entire conversation 
  * Only technical terms and product names should be in English (e.g., "field sales", "CTC", etc.) 
  * When ending the call in a regional language, still use the disconnect_call function with the reason in English 
- Be prepared to handle code-switching (mixing of languages) which is common in Indian conversations 

Language Detection: 
At the start of the conversation, detect the primary language being used by the applicant. 
If the applicant initiates the conversation in Hindi, Tamil, Telugu, Bengali, Marathi, or any other Indian language, switch to that language immediately. 

Maintain Consistency: 
Once the applicant's language is identified, continue the rest of the conversation in that same language. 
Only technical job-related terms (e.g., "field sales," "CTC," "branch location") should remain in English for clarity and consistency. 

Code-Switching Support: 
If the applicant switches language mid-way (e.g., from English to Hindi), detect the new language. 
Transition to the new language gracefully and continue the conversation accordingly. 
Example: 
"Koi dikkat nahi, aaiye Hindi mein baat karte hain." 
("No problem, let's continue in Hindi.") 

End-of-Call Protocol: 
Regardless of the spoken language, the disconnect_call function must always log the reason for ending the call in English (for backend processing). 

Tone & Respect: 
Maintain the same warmth, clarity, and respectful tone in regional languages as in English. 
Avoid overly casual phrases or dialectal slang; keep it neutral and professional. 

TOOLS TO USE: 
1. record_candidate_response - Use after each question to record the candidate's answer 
2. evaluate_candidate - Use at the end of the call to provide an overall assessment 
3. disconnect_call - CRITICAL: You MUST use this tool to end the call when any of the critical requirements are not met 

IMPORTANT INSTRUCTIONS FOR ENDING CALLS: 
- You MUST use the disconnect_call tool when a candidate fails any of the critical requirements 
- After saying your polite goodbye message, IMMEDIATELY call the disconnect_call tool with the appropriate reason 
- Do not continue the interview if any critical requirement is not met 
- The four critical requirements are: job change status, field sales comfort, product experience, and location 
- Example: If candidate says they are not looking for a job change, say goodbye and then call disconnect_call with reason "Candidate not looking for job change" 

CRITICAL: DISCONNECT CALL INSTRUCTIONS 
When a candidate fails any critical requirement: 
1. Say your polite goodbye message 
2. IMMEDIATELY call the disconnect_call function with the reason 
3. Do not say anything else or ask any more questions after calling disconnect_call 
4. You MUST use the proper function calling mechanism, NOT text that looks like a function call 

   CORRECT WAY (use the actual function calling capability): 
   After saying goodbye, call the disconnect_call function 

   INCORRECT WAY (do not do this): 
   Do not type out "<function_call>" as text in your response 

5. The call will automatically end after you call this function 
6. IMPORTANT: You MUST call the disconnect_call function, not just say goodbye 
7. CRITICAL: If the candidate says "No" to any critical question, you MUST call disconnect_call 
8. DO NOT include the function call as text in your response - use the actual function calling mechanism 

IMPORTANT: Be thorough in your questioning but also efficient with time. If at any point the candidate clearly doesn't meet a critical requirement, politely end the call rather than continuing with all questions.`;
    
    console.log("Sending OpenAI session update with instructions:", instructions.substring(0, 200) + "...");
    
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
    
    jsonSend(session.modelConn, sessionConfig);
    console.log("OpenAI session configuration sent");
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
      }
      break;
    }

    case "response.audio.delta": {
      if (session.twilioConn && session.streamSid) {
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = session.latestMediaTimestamp || 0;
        }
        if (event.item_id) session.lastAssistantItem = event.item_id;

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
    const analysis = await analyzeTranscript(textTranscript, cvInfo);
    console.log(`⏱️ Analysis completed at: ${new Date().toISOString()}`);
    
    // Update MongoDB with transcript and analysis
    console.log(`💾 Saving transcript and analysis to MongoDB...`);
    await updateCandidateInterviewWithTranscript(callSid, textTranscript, analysis);
    console.log(`✅ Transcript and analysis saved to MongoDB successfully`);
    
    // Update call status to COMPLETED
    await updateCandidateInterviewStatus(callSid, CallStatus.COMPLETED);
    console.log(`✅ Call status updated to COMPLETED in MongoDB`);
    
    console.log("=== TRANSCRIPT PROCESSING COMPLETED SUCCESSFULLY ===");
    
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
