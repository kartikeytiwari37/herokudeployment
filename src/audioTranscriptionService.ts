import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { getFileFromS3 } from './s3Service';
import { updateCandidateInterviewWithAudioTranscription } from './db';

// Load environment variables
dotenv.config();

/**
 * Transcribe audio file from S3 using OpenAI API
 * @param s3Key S3 key of the audio file
 * @param callSid Call SID for the interview
 */
export async function transcribeAudioFromS3(s3Key: string, callSid: string): Promise<string> {
  try {
    console.log(`=== STARTING AUDIO TRANSCRIPTION FOR CALL SID: ${callSid} ===`);
    console.log(`S3 Key: ${s3Key}`);
    
    // Get the file from S3
    console.log(`Retrieving audio file from S3...`);
    const s3Object = await getFileFromS3(s3Key);
    
    if (!s3Object.Body) {
      throw new Error('S3 object body is empty');
    }
    
    // Get OpenAI API key from environment variables
    const openaiApiKey = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not found in environment variables');
    }
    
    // Create a temporary file to store the audio
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = path.join(tempDir, `${callSid}-recording.mp3`);
    console.log(`Saving audio to temporary file: ${tempFilePath}`);
    
    // Convert S3 object body to buffer
    let audioBuffer: Buffer;
    if (s3Object.Body instanceof Buffer) {
      audioBuffer = s3Object.Body;
    } else {
      // Convert stream to buffer
      const chunks: Buffer[] = [];
      const stream = s3Object.Body as Readable;
      
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      
      audioBuffer = Buffer.concat(chunks);
    }
    
    // Write buffer to temporary file
    fs.writeFileSync(tempFilePath, audioBuffer);
    console.log(`Audio file saved to temporary location (${audioBuffer.length} bytes)`);
    
    // Create form data for OpenAI API request
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tempFilePath));
    formData.append('model', 'gpt-4o-transcribe');
    
    // Add prompt for transcription formatting
    const prompt = `This is a recording of a phone conversation between a job candidate (Caller) and an AI HR screening assistant named Shruti (Assistant). The transcription should clearly distinguish between the two speakers.
STRICT INSTRUCTIONS:
1. Every line of the conversation must start with either:
   - Caller: 
   - Assistant:
2. The format must alternate based on who is speaking. Use context to infer speaker turns, even if it's not always obvious.
3. Do NOT skip speaker labels under any circumstance. Each spoken line must be attributed.
4. Use this exact format:
Caller: [what the candidate says]
Assistant: [what Shruti says]
5. Maintain natural language switches between English, Hindi, and Hinglish. Preserve fillers (e.g., "hmm", "haan", "uh", etc.) and conversational tone.
6. Add line breaks between each speaker's turn. Do not combine multiple turns on the same line.
7. DO NOT include any summaries, analysis, or extra commentary. Only return the verbatim transcription with correct speaker labels.
Your response must follow this format exactly.`;
    
    formData.append('prompt', prompt);
    
    // Make request to OpenAI API
    console.log(`Sending request to OpenAI API for transcription...`);
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: formData as any
    });
    
    // Clean up temporary file
    try {
      fs.unlinkSync(tempFilePath);
      console.log(`Temporary file deleted: ${tempFilePath}`);
    } catch (cleanupError) {
      console.error(`Error deleting temporary file: ${cleanupError}`);
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const result = await response.json();
    const transcription = result.text;
    
    console.log(`Transcription completed successfully (${transcription.length} characters)`);
    console.log(`First 200 characters of transcription: ${transcription.substring(0, 200)}...`);
    
    return transcription;
  } catch (error) {
    console.error(`Error transcribing audio from S3:`, error);
    throw error;
  }
}

/**
 * Analyze audio transcription using OpenAI API
 * @param transcription The transcription to analyze
 * @param callSid Call SID for the interview
 * @param cvInfo Optional CV information for verification
 */
export async function analyzeAudioTranscription(
  transcription: string, 
  callSid: string,
  cvInfo?: any
): Promise<string> {
  try {
    console.log(`=== STARTING AUDIO TRANSCRIPTION ANALYSIS FOR CALL SID: ${callSid} ===`);
    console.log(`Transcription length: ${transcription.length} characters`);
    
    // Check if transcription is empty
    if (!transcription || transcription.trim().length === 0) {
      console.log("Transcription is empty, skipping analysis");
      return "No transcript content to analyze.";
    }
    
    // Check for non-English content
    const hasHindiContent = /[\u0900-\u097F]/.test(transcription);
    const hasNonEnglishContent = transcription.split('').some(char => char.charCodeAt(0) > 127);
    
    if (hasHindiContent) {
      console.log(`Detected Hindi content in transcription`);
    }
    if (hasNonEnglishContent) {
      console.log(`Detected non-English content in transcription`);
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
    
    // Get OpenAI API key from environment variables
    const openaiApiKey = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not found in environment variables');
    }
    
    // Prompt for analysis
    const prompt = `
      You are an expert recruitment analyst evaluating an initial screening call for frontline sales staff positions.
      The AI assistant in this conversation was conducting an initial screening interview to check the basic qualifications of the candidate.
      
      ${hasHindiContent ? "IMPORTANT: This transcript contains content in Hindi. As a multilingual analyzer, please analyze both Hindi and English portions of the conversation." : ""}
      ${hasNonEnglishContent ? "IMPORTANT: This transcript contains content in a non-English language. Please do your best to analyze it, focusing on the overall structure of the conversation." : ""}
      
      PRODUCT EXPERIENCE MAPPING:
      Housing Finance: Home Loans, Mortgages, LAP (Loan Against Property)
      SBL (Secured Business Loans): Pure LAP & Home loans
      UBL (Unsecured Business Loans): Small Business Banking, Unsecured Loans, Business Loans
      PL (Personal Loans): Credit Card & PL, CA (Current Accounts) SA (Savings Accounts) & PL, PL & GL (Gold Loans)
      UCL (Used Car Loans): Auto Loans, 4 wheeler loans, CV (Commercial Vehicle), Used Car, Sales Dealership
      MLAP (Micro LAP): Pure Low LAP or LAP & Home Loans
      
      When analyzing work experience, cross-reference candidate's mentioned products with required product using above mapping. If candidate has relevant experience per mapping, mark as qualified; if not, mark as NO GO.
      
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
      ${transcription}
    `;
    
    // Make request to OpenAI API
    console.log(`Sending request to OpenAI API for analysis...`);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert multilingual call analyzer providing detailed insights on conversation transcripts. You can understand and analyze content in multiple languages including Hindi. Your analysis should be thorough, well-structured, and include clear headings and bullet points.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const result = await response.json();
    const analysis = result.choices?.[0]?.message?.content || "No analysis available";
    
    console.log(`Analysis completed successfully (${analysis.length} characters)`);
    console.log(`First 200 characters of analysis: ${analysis.substring(0, 200)}...`);
    
    return analysis;
  } catch (error) {
    console.error(`Error analyzing audio transcription:`, error);
    throw error;
  }
}

/**
 * Process audio recording from S3 - transcribe, analyze, and save to database
 * @param s3Key S3 key of the audio file
 * @param callSid Call SID for the interview
 */
export async function processAudioRecording(s3Key: string, callSid: string): Promise<void> {
  try {
    console.log(`=== PROCESSING AUDIO RECORDING FOR CALL SID: ${callSid} ===`);
    console.log(`S3 Key: ${s3Key}`);
    
    // Get the candidate interview record to access CV information
    const { getCandidateInterview } = await import('./db');
    const interview = await getCandidateInterview(callSid);
    
    if (!interview) {
      throw new Error(`No interview found for call SID: ${callSid}`);
    }
    
    // Extract CV information if available
    const cvInfo = interview?.candidateInfo?.cvInfo;
    if (cvInfo) {
      console.log(`Found CV information for candidate in interview record`);
    } else {
      console.log(`No CV information found for candidate in interview record`);
    }
    
    // Step 1: Transcribe the audio
    console.log(`Step 1: Transcribing audio...`);
    const transcription = await transcribeAudioFromS3(s3Key, callSid);
    
    // Step 2: Analyze the transcription
    console.log(`Step 2: Analyzing transcription...`);
    const analysis = await analyzeAudioTranscription(transcription, callSid, cvInfo);
    
    // Step 3: Save to database
    console.log(`Step 3: Saving transcription and analysis to database...`);
    await updateCandidateInterviewWithAudioTranscription(callSid, transcription, analysis);
    
    console.log(`=== AUDIO PROCESSING COMPLETED SUCCESSFULLY FOR CALL SID: ${callSid} ===`);
  } catch (error) {
    console.error(`Error processing audio recording:`, error);
    throw error;
  }
}
