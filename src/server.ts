import express from "express";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import http from "http";
import fs from "fs";
import path from "path";
import cors from "cors";
import { handleTwilioConnection, getSession } from "./sessionManager";
import twilio from "twilio";
import { connectToMongoDB, createCandidateInterview, updateCandidateInterviewStatus, CallStatus, getCandidateInterview } from "./db";
import multer from "multer";
import { uploadMultipleFilesToS3, isS3Configured } from "./s3Service";
import { parseCandidateCSV } from "./csvParser";

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectToMongoDB().catch(err => {
  console.error("Failed to connect to MongoDB:", err);
});

// Get environment variables
const PORT = parseInt(process.env.PORT || "3000", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const PATH_PREFIX = process.env.PATH_PREFIX || "";
const AI_PROVIDER = process.env.AI_PROVIDER || "openai";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY || "";
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || "";
const AZURE_OPENAI_DEPLOYMENT_NAME = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "";
const AZURE_OPENAI_VERSION = process.env.AZURE_OPENAI_VERSION || "2025-04-01-preview";

// Azure OpenAI configuration for analysis
const AZURE_OPENAI_ANALYSIS_API_KEY = process.env.AZURE_OPENAI_ANALYSIS_API_KEY || "";
const AZURE_OPENAI_ANALYSIS_ENDPOINT = process.env.AZURE_OPENAI_ANALYSIS_ENDPOINT || "";
const AZURE_OPENAI_ANALYSIS_DEPLOYMENT_ID = process.env.AZURE_OPENAI_ANALYSIS_DEPLOYMENT_ID || "";
const AZURE_OPENAI_ANALYSIS_API_VERSION = process.env.AZURE_OPENAI_ANALYSIS_API_VERSION || "2024-02-15-preview";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

// Check required environment variables
if (AI_PROVIDER === "openai" && !OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY environment variable is required when using OpenAI");
  process.exit(1);
} else if (AI_PROVIDER === "azure" && (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_DEPLOYMENT_NAME)) {
  console.error("Azure OpenAI configuration is incomplete. AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_DEPLOYMENT_NAME are required");
  process.exit(1);
}

console.log(`Using AI provider: ${AI_PROVIDER}`);

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.error("Twilio credentials are required");
  process.exit(1);
}

// Initialize Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Available Twilio phone numbers
let availablePhoneNumbers: any[] = [];

// Fetch Twilio phone numbers
async function fetchTwilioPhoneNumbers() {
  try {
    availablePhoneNumbers = await twilioClient.incomingPhoneNumbers.list({
      limit: 20,
    });
    console.log(`Fetched ${availablePhoneNumbers.length} Twilio phone numbers`);
    
    if (availablePhoneNumbers.length === 0) {
      console.warn("No Twilio phone numbers found. You need at least one phone number to make calls.");
    }
  } catch (error) {
    console.error("Error fetching Twilio phone numbers:", error);
    
    // Add a default phone number if we can't fetch from Twilio
    // This allows the application to work even if Twilio credentials are invalid
    if (availablePhoneNumbers.length === 0) {
      const defaultPhoneNumber = process.env.DEFAULT_PHONE_NUMBER || "+15555555555";
      console.log(`Using default phone number: ${defaultPhoneNumber}`);
      availablePhoneNumbers = [{
        sid: "default",
        phoneNumber: defaultPhoneNumber,
        friendlyName: "Default Phone Number"
      }];
    }
  }
}

// Fetch phone numbers on startup, but don't block server startup
fetchTwilioPhoneNumbers().catch(err => {
  console.error("Failed to fetch phone numbers on startup:", err);
});

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Create a router with the path prefix
const router = express.Router();

// Configure multer for CV uploads (PDF and Word documents)
const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file size limit
    files: 20 // Maximum 20 files per upload
  },
  fileFilter: (req, file, callback) => {
    // Accept only PDF and Word documents
    const allowedMimeTypes = [
      'application/pdf',                                                  // PDF
      'application/msword',                                               // DOC
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
      'application/vnd.ms-word.document.macroEnabled.12',                 // DOCM
      'application/vnd.ms-word.template.macroEnabled.12',                 // DOTM
      'application/vnd.openxmlformats-officedocument.wordprocessingml.template'  // DOTX
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      // Accept the file
      callback(null, true);
    } else {
      // Reject the file
      callback(new Error('Only PDF and Word documents are allowed'));
    }
  }
});

// Configure multer for CSV uploads
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB file size limit
  },
  fileFilter: (req, file, callback) => {
    // Accept only CSV files
    if (file.mimetype === 'text/csv' || 
        file.originalname.toLowerCase().endsWith('.csv')) {
      // Accept the file
      callback(null, true);
    } else {
      // Reject the file
      callback(new Error('Only CSV files are allowed'));
    }
  }
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Read TwiML template
const twimlPath = path.join(__dirname, "twiml.xml");
const twimlTemplate = fs.readFileSync(twimlPath, "utf-8");

// Routes
router.get("/", (req, res) => {
  res.send("Voice Backend API is running");
});

// Store call parameters for later use
const callParameters = new Map<string, {
  callSid?: string;
  name?: string;
  location?: string;
  product?: string;
}>();

// Make callParameters available globally
(global as any).callParameters = callParameters;

// TwiML endpoint for Twilio to connect to
router.all("/twiml", (req, res) => {
  // Log basic information about the request
  console.log("TwiML endpoint called");
  
  const wsUrl = new URL(PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `${PATH_PREFIX}/call`;
  
  // Generate TwiML with WebSocket URL
  const twimlContent = twimlTemplate.replace("{{WS_URL}}", wsUrl.toString());
  console.log("Generated TwiML with WebSocket URL:", wsUrl.toString());
  
  // Send TwiML response
  res.type("text/xml").send(twimlContent);
});

// API endpoint to get available phone numbers
router.get("/api/numbers", async (req, res) => {
  try {
    // Refresh the list of phone numbers
    await fetchTwilioPhoneNumbers();
    
    // Return the list of phone numbers
    return res.json(availablePhoneNumbers.map(number => ({
      sid: number.sid,
      phoneNumber: number.phoneNumber,
      friendlyName: number.friendlyName
    })));
  } catch (error) {
    console.error("Error fetching phone numbers:", error);
    return res.status(500).json({
      error: "Failed to fetch phone numbers",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// API endpoint to initiate a call
router.post("/api/call", async (req, res) => {
  try {
    const { 
      number, 
      fromNumber, 
      name, 
      location, 
      product 
    } = req.body;
    
    if (!number) {
      return res.status(400).json({ error: "Phone number is required" });
    }
    
    // If no fromNumber is provided, use the first available phone number
    let from = fromNumber;
    if (!from) {
      if (availablePhoneNumbers.length === 0) {
        // Try to fetch phone numbers if none are available
        try {
          await fetchTwilioPhoneNumbers();
        } catch (error) {
          console.error("Error fetching phone numbers:", error);
        }
        
        if (availablePhoneNumbers.length === 0) {
          // Use a default phone number as a last resort
          const defaultPhoneNumber = process.env.DEFAULT_PHONE_NUMBER || "+15555555555";
          console.log(`Using default phone number: ${defaultPhoneNumber}`);
          availablePhoneNumbers = [{
            sid: "default",
            phoneNumber: defaultPhoneNumber,
            friendlyName: "Default Phone Number"
          }];
        }
      }
      
      from = availablePhoneNumbers[0].phoneNumber;
    }
    
    // Log the call details
    console.log(`Initiating call to ${number} from ${from}`);
    console.log(`Customer Name: ${name || 'Not provided'}`);
    console.log(`Customer Location: ${location || 'Not provided'}`);
    console.log(`Customer Product: ${product || 'Not provided'}`);
    
  // Create TwiML URL with path prefix
  const twimlUrl = `${PUBLIC_URL}${PATH_PREFIX}/twiml`;
    
    try {
      // Initiate call using Twilio
      const call = await twilioClient.calls.create({
        to: number,
        from: from,
        url: twimlUrl,
      });
      
      // Store the call parameters directly with the callSid as the key
      callParameters.set(call.sid, {
        name,
        location,
        product,
        callSid: call.sid
      });
      
      console.log(`Stored parameters for callSid ${call.sid}:`, callParameters.get(call.sid));
      console.log("Available parameters:", Array.from(callParameters.entries()));
      
      console.log(`Call initiated with SID: ${call.sid}`);
      
      // Create a record in MongoDB
      const candidateInfo = {
        name: name || 'Unknown',
        phoneNumber: number
      };
      
      const jobDetails = {
        location: location || 'Unknown',
        requiredProduct: product || 'Unknown',
        designation: 'Field Sales Executive'
      };
      
      await createCandidateInterview(call.sid, candidateInfo, jobDetails);
      
      return res.json({
        success: true,
        callSid: call.sid,
        message: `Call initiated to ${number}`
      });
    } catch (twilioError) {
      console.error("Twilio API error:", twilioError);
      return res.status(500).json({
        error: "Failed to initiate call through Twilio",
        details: twilioError instanceof Error ? twilioError.message : "Unknown Twilio error"
      });
    }
  } catch (error) {
    console.error("Error initiating call:", error);
    return res.status(500).json({
      error: "Failed to initiate call",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// API endpoint to end a call
router.post("/api/end-call", async (req, res) => {
  try {
    const { callSid } = req.body;
    
    if (!callSid) {
      return res.status(400).json({ error: "Call SID is required" });
    }
    
    console.log(`Ending call with SID: ${callSid}`);
    
    // End call using Twilio
    await twilioClient.calls(callSid).update({
      status: "completed"
    });
    
    return res.json({
      success: true,
      message: "Call ended successfully"
    });
  } catch (error) {
    console.error("Error ending call:", error);
    return res.status(500).json({
      error: "Failed to end call",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// API endpoint for AI to disconnect a call with a reason
router.post("/api/disconnect-call", async (req, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ error: "Reason is required" });
    }
    
    // Get the current session
    const session = getSession();
    
    // Store the disconnect reason in the session
    if (session.callSid) {
      console.log(`Disconnecting call with SID: ${session.callSid}, reason: ${reason}`);
      
      // Set the disconnect reason
      session.disconnectReason = reason;
      
      // End the call using Twilio
      await twilioClient.calls(session.callSid).update({
        status: "completed"
      });
      
      return res.json({
        success: true,
        message: `Call disconnected: ${reason}`
      });
    } else {
      return res.status(400).json({ error: "No active call to disconnect" });
    }
  } catch (error) {
    console.error("Error disconnecting call:", error);
    return res.status(500).json({
      error: "Failed to disconnect call",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// API endpoint to get transcript for a call
router.get("/api/transcript/:callSid", async (req, res) => {
  try {
    const { callSid } = req.params;
    
    if (!callSid) {
      return res.status(400).json({ error: "Call SID is required" });
    }
    
    console.log(`Getting transcript for call SID: ${callSid}`);
    
    // Get the transcript from MongoDB
    const interview = await getCandidateInterview(callSid);
    
    if (!interview || !interview.screeningInfo || !interview.screeningInfo.transcript) {
      return res.status(404).json({ error: `No transcript found for call SID: ${callSid}` });
    }
    
    // Return the transcript from MongoDB
    console.log(`Found transcript in MongoDB for call SID: ${callSid}`);
    return res.type('text/plain').send(interview.screeningInfo.transcript);
    
  } catch (error) {
    console.error("Error getting transcript:", error);
    return res.status(500).json({
      error: "Failed to get transcript",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// API endpoint to download transcript or analysis as a text file
router.get("/api/download/:callSid", async (req, res) => {
  try {
    const { callSid } = req.params;
    const { type } = req.query;
    
    if (!callSid) {
      return res.status(400).json({ error: "Call SID is required" });
    }
    
    if (!type || (type !== 'transcript' && type !== 'analysis')) {
      return res.status(400).json({ 
        error: "Invalid type parameter", 
        details: "Type must be either 'transcript' or 'analysis'" 
      });
    }
    
    console.log(`Downloading ${type} for call SID: ${callSid}`);
    
    // Get the interview from MongoDB
    const interview = await getCandidateInterview(callSid);
    
    if (!interview) {
      return res.status(404).json({ error: `No interview found for call SID: ${callSid}` });
    }
    
    let content = '';
    let filename = '';
    
    if (type === 'transcript') {
      if (!interview.screeningInfo || !interview.screeningInfo.transcript) {
        return res.status(404).json({ error: `No transcript found for call SID: ${callSid}` });
      }
      content = interview.screeningInfo.transcript;
      filename = `${callSid}_transcript.txt`;
    } else { // type === 'analysis'
      if (!interview.screeningInfo || !interview.screeningInfo.analysis) {
        return res.status(404).json({ error: `No analysis found for call SID: ${callSid}` });
      }
      content = interview.screeningInfo.analysis;
      filename = `${callSid}_analysis.txt`;
    }
    
    // Set headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/plain');
    
    // Return the content as a downloadable file
    console.log(`Sending ${type} as downloadable file: ${filename}`);
    return res.send(content);
    
  } catch (error) {
    console.error(`Error downloading ${req.query.type || 'file'}:`, error);
    return res.status(500).json({
      error: `Failed to download ${req.query.type || 'file'}`,
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// API endpoint to get analysis for a call
router.get("/api/analysis/:callSid", async (req, res) => {
  try {
    console.log(`=== RETRIEVING ANALYSIS FOR CALL SID: ${req.params.callSid} ===`);
    
    const { callSid } = req.params;
    
    if (!callSid) {
      console.log("⚠️ Error: Call SID is required");
      return res.status(400).json({ error: "Call SID is required" });
    }
    
    // Get the analysis from MongoDB
    const interview = await getCandidateInterview(callSid);
    
    if (!interview || !interview.screeningInfo || !interview.screeningInfo.analysis) {
      console.log("⚠️ Error: No analysis found for this call SID");
      return res.status(404).json({ error: `No analysis found for call SID: ${callSid}` });
    }
    
    // Return the analysis from MongoDB
    console.log(`Found analysis in MongoDB for call SID: ${callSid}`);
    return res.type('text/plain').send(interview.screeningInfo.analysis);
    
  } catch (error) {
    console.error("Error getting analysis:", error);
    return res.status(500).json({
      error: "Failed to get analysis",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// API endpoint for bulk CV upload
router.post("/api/cv/bulk-upload", (req, res) => {
  cvUpload.array('files')(req, res, async (err) => {
    try {
      // Handle multer errors (including file type validation)
      if (err) {
        console.error('Multer error:', err.message);
        return res.status(400).json({
          error: 'File upload error',
          details: err.message
        });
      }
      
      // Check if S3 is configured
      if (!isS3Configured()) {
        return res.status(500).json({
          error: 'S3 is not properly configured',
          details: 'Missing required AWS environment variables'
        });
      }

      // Check if files were provided
      if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
        return res.status(400).json({
          error: 'No files were uploaded',
          details: 'Please select at least one file to upload'
        });
      }

      // Cast req.files to the correct type
      const files = req.files as Express.Multer.File[];
      
      console.log(`Received ${files.length} files for upload`);
      
      // Upload files to S3
      const uploadResults = await uploadMultipleFilesToS3(files);
    
      // Return success response with upload details
      return res.status(200).json({
        success: true,
        message: `Successfully uploaded ${files.length} files to S3`,
        files: uploadResults.map(result => ({
          originalName: result.Key,
          location: result.Location,
          etag: result.ETag
        }))
      });
    } catch (error) {
      console.error('Error in bulk CV upload:', error);
      return res.status(500).json({
        error: 'Failed to upload files',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
});

// API endpoint to auto-trigger a call for a pending candidate
router.post("/api/auto-trigger-call", async (req, res) => {
  try {
    console.log("Auto-triggering call for a pending candidate...");
    
    // Get a pending bulk record
    const { getPendingBulkRecord, updateBulkRecordWithCallSid } = await import("./db");
    const pendingRecord = await getPendingBulkRecord();
    
    if (!pendingRecord) {
      return res.status(404).json({
        success: false,
        message: "No pending candidates found"
      });
    }
    
    console.log(`Found pending candidate: ${pendingRecord.name}`);
    
    // Prepare call parameters
    const callParams = {
      number: pendingRecord.phoneNumber,
      name: pendingRecord.name,
      location: pendingRecord.location,
      product: pendingRecord.product,
      cvInfo: pendingRecord.cvInfo
    };
    
    // Make internal request to call API
    const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    
    // Create TwiML URL with path prefix
    const twimlUrl = `${PUBLIC_URL}${PATH_PREFIX}/twiml`;
    
    // Get a phone number to call from
    let fromNumber;
    if (availablePhoneNumbers.length === 0) {
      // Try to fetch phone numbers if none are available
      try {
        await fetchTwilioPhoneNumbers();
      } catch (error) {
        console.error("Error fetching phone numbers:", error);
      }
      
      if (availablePhoneNumbers.length === 0) {
        // Use a default phone number as a last resort
        const defaultPhoneNumber = process.env.DEFAULT_PHONE_NUMBER || "+15555555555";
        console.log(`Using default phone number: ${defaultPhoneNumber}`);
        fromNumber = defaultPhoneNumber;
      } else {
        fromNumber = availablePhoneNumbers[0].phoneNumber;
      }
    } else {
      fromNumber = availablePhoneNumbers[0].phoneNumber;
    }
    
    try {
      // Initiate call using Twilio
      const call = await twilioClient.calls.create({
        to: callParams.number,
        from: fromNumber,
        url: twimlUrl,
      });
      
      console.log(`Call initiated with SID: ${call.sid}`);
      
      // Store the call parameters directly with the callSid as the key
      callParameters.set(call.sid, {
        name: callParams.name,
        location: callParams.location,
        product: callParams.product,
        callSid: call.sid
      });
      
      // Create a record in MongoDB
      const candidateInfo = {
        name: callParams.name || 'Unknown',
        phoneNumber: callParams.number,
        cvInfo: callParams.cvInfo
      };
      
      const jobDetails = {
        location: callParams.location || 'Unknown',
        requiredProduct: callParams.product || 'Unknown',
        designation: pendingRecord.designation || 'Field Sales Executive'
      };
      
      await createCandidateInterview(call.sid, candidateInfo, jobDetails);
      
      // Update bulk record with call SID and status
      await updateBulkRecordWithCallSid(pendingRecord._id.toString(), call.sid);
      
      return res.json({
        success: true,
        message: `Auto-triggered call to ${callParams.name} (${callParams.number})`,
        callSid: call.sid,
        candidateId: pendingRecord._id
      });
    } catch (twilioError) {
      console.error("Twilio API error:", twilioError);
      return res.status(500).json({
        error: "Failed to initiate call through Twilio",
        details: twilioError instanceof Error ? twilioError.message : "Unknown Twilio error"
      });
    }
  } catch (error) {
    console.error("Error auto-triggering call:", error);
    return res.status(500).json({
      error: "Failed to auto-trigger call",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// API endpoint to get a specific bulk record by ID
router.get("/api/candidates/bulk-records/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: "Record ID is required" });
    }
    
    const { getBulkRecordById } = await import("./db");
    
    // Get the record
    const record = await getBulkRecordById(id);
    
    if (!record) {
      return res.status(404).json({ error: `No record found with ID: ${id}` });
    }
    
    // Return the record
    return res.status(200).json({
      success: true,
      record: {
        id: record._id,
        name: record.name,
        location: record.location,
        product: record.product,
        designation: record.designation,
        phoneNumber: record.phoneNumber,
        status: record.status,
        cvFilename: record.cvFilename,
        cvInfo: record.cvInfo,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }
    });
  } catch (error) {
    console.error(`Error getting bulk record by ID:`, error);
    return res.status(500).json({
      error: 'Failed to get bulk record',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API endpoint to get all bulk records
router.get("/api/candidates/bulk-records", async (req, res) => {
  try {
    const { getAllBulkRecords } = await import("./db");
    
    // Get all bulk records
    const records = await getAllBulkRecords();
    
    // Return records
    return res.status(200).json({
      success: true,
      count: records.length,
      records: records.map(record => ({
        id: record._id,
        name: record.name,
        location: record.location,
        product: record.product,
        designation: record.designation,
        phoneNumber: record.phoneNumber,
        status: record.status,
        cvFilename: record.cvFilename,
        hasCvInfo: !!record.cvInfo,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }))
    });
  } catch (error) {
    console.error('Error getting bulk records:', error);
    return res.status(500).json({
      error: 'Failed to get bulk records',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API endpoint to search bulk records with optional status filter and pagination
router.get("/api/bulk-records/search", async (req, res) => {
  try {
    const { searchBulkRecords, BulkRecordStatus } = await import("./db");
    
    // Parse query parameters
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    
    // Validate page and limit
    if (page < 1) {
      return res.status(400).json({
        error: 'Invalid page number',
        details: 'Page number must be greater than or equal to 1'
      });
    }
    
    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        error: 'Invalid limit',
        details: 'Limit must be between 1 and 100'
      });
    }
    
    // Validate status if provided
    let statusFilter: typeof BulkRecordStatus[keyof typeof BulkRecordStatus] | undefined;
    if (status) {
      // Check if status is valid
      if (Object.values(BulkRecordStatus).includes(status as typeof BulkRecordStatus[keyof typeof BulkRecordStatus])) {
        statusFilter = status as typeof BulkRecordStatus[keyof typeof BulkRecordStatus];
      } else {
        return res.status(400).json({
          error: 'Invalid status',
          details: `Status must be one of: ${Object.values(BulkRecordStatus).join(', ')}`
        });
      }
    }
    
    console.log(`Searching bulk records with status: ${statusFilter || 'All'}, page: ${page}, limit: ${limit}`);
    
    // Search bulk records
    const result = await searchBulkRecords(statusFilter, page, limit);
    
    // Return results
    return res.status(200).json({
      success: true,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      records: result.records.map(record => ({
        id: record._id,
        name: record.name,
        location: record.location,
        product: record.product,
        designation: record.designation,
        phoneNumber: record.phoneNumber,
        status: record.status,
        cvFilename: record.cvFilename,
        hasCvInfo: !!record.cvInfo,
        cvInfo: record.cvInfo, // Include the full cvInfo object
        callSid: record.callSid,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }))
    });
  } catch (error) {
    console.error('Error searching bulk records:', error);
    return res.status(500).json({
      error: 'Failed to search bulk records',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API endpoint to search candidate interviews with optional status filter and pagination
router.get("/api/candidateInterviews/search", async (req, res) => {
  try {
    const { searchCandidateInterviews, CallStatus } = await import("./db");
    
    // Parse query parameters
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    
    // Validate page and limit
    if (page < 1) {
      return res.status(400).json({
        error: 'Invalid page number',
        details: 'Page number must be greater than or equal to 1'
      });
    }
    
    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        error: 'Invalid limit',
        details: 'Limit must be between 1 and 100'
      });
    }
    
    // Validate status if provided
    let statusFilter: typeof CallStatus[keyof typeof CallStatus] | undefined;
    if (status) {
      // Check if status is valid
      if (Object.values(CallStatus).includes(status as typeof CallStatus[keyof typeof CallStatus])) {
        statusFilter = status as typeof CallStatus[keyof typeof CallStatus];
      } else {
        return res.status(400).json({
          error: 'Invalid status',
          details: `Status must be one of: ${Object.values(CallStatus).join(', ')}`
        });
      }
    }
    
    console.log(`Searching candidate interviews with status: ${statusFilter || 'All'}, page: ${page}, limit: ${limit}`);
    
    // Search candidate interviews
    const result = await searchCandidateInterviews(statusFilter, page, limit);
    
    // Return results
    return res.status(200).json({
      success: true,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      interviews: result.interviews.map(interview => ({
        callSid: interview._id,
        candidateInfo: interview.candidateInfo,
        jobDetails: interview.jobDetails,
        status: interview.status,
        screeningInfo: interview.screeningInfo,
        createdAt: interview.createdAt,
        updatedAt: interview.updatedAt
      }))
    });
  } catch (error) {
    console.error('Error searching candidate interviews:', error);
    return res.status(500).json({
      error: 'Failed to search candidate interviews',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/health', (req, res) => {
  res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      service: 'tatkal-pulse-websocket-server'
  });
});


// API endpoint for bulk candidate upload via CSV
router.post("/api/candidates/bulk-upload", (req, res) => {
  csvUpload.single('file')(req, res, async (err) => {
    try {
      // Handle multer errors
      if (err) {
        console.error('Multer error:', err.message);
        return res.status(400).json({
          error: 'File upload error',
          details: err.message
        });
      }
      
      // Check if file was provided
      if (!req.file) {
        return res.status(400).json({
          error: 'No file was uploaded',
          details: 'Please select a CSV file to upload'
        });
      }
      
      // Check file type
      if (!req.file.mimetype.includes('csv') && !req.file.originalname.toLowerCase().endsWith('.csv')) {
        return res.status(400).json({
          error: 'Invalid file type',
          details: 'Only CSV files are allowed'
        });
      }
      
      console.log(`Received CSV file: ${req.file.originalname} (${req.file.size} bytes)`);
      
      // Parse CSV and create bulk records
      const results = await parseCandidateCSV(req.file.buffer);
      
      // Return success response
      return res.status(200).json({
        success: true,
        message: `Successfully processed ${results.length} candidates`,
        candidates: results.map(record => ({
          id: record._id,
          name: record.name,
          status: record.status
        }))
      });
    } catch (error) {
      console.error('Error in bulk candidate upload:', error);
      return res.status(500).json({
        error: 'Failed to process CSV file',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
});

// Register the router with the path prefix
app.use(PATH_PREFIX, router);

// WebSocket connection handler
wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);
  
  // Remove path prefix parts from the URL if present
  let pathPrefixParts: string[] = [];
  if (PATH_PREFIX) {
    pathPrefixParts = PATH_PREFIX.split("/").filter(Boolean);
    // Remove path prefix parts from the beginning of the URL
    if (pathPrefixParts.length > 0 && parts.length >= pathPrefixParts.length) {
      const potentialPrefix = parts.slice(0, pathPrefixParts.length).join('/');
      if (potentialPrefix === pathPrefixParts.join('/')) {
        // Remove the prefix parts
        parts.splice(0, pathPrefixParts.length);
      }
    }
  }
  
  if (parts.length < 1) {
    console.log("Invalid WebSocket connection path");
    ws.close();
    return;
  }
  
  const type = parts[0];
  
  if (type === "call") {
    console.log("New Twilio call connection");
    
    // Log available call parameters for debugging
    console.log("Available call parameters:", Array.from(callParameters.entries()));
    
    // We don't need to get parameters here anymore
    // The parameters will be retrieved in the sessionManager.ts file
    // using the callSid from the 'start' event
    
    // Configure AI settings based on provider
    const aiConfig = {
      provider: AI_PROVIDER,
      openai: {
        apiKey: OPENAI_API_KEY
      },
      azure: {
        apiKey: AZURE_OPENAI_API_KEY,
        endpoint: AZURE_OPENAI_ENDPOINT,
        deploymentName: AZURE_OPENAI_DEPLOYMENT_NAME,
        version: AZURE_OPENAI_VERSION
      },
      azureAnalysis: {
        apiKey: AZURE_OPENAI_ANALYSIS_API_KEY,
        endpoint: AZURE_OPENAI_ANALYSIS_ENDPOINT,
        deploymentId: AZURE_OPENAI_ANALYSIS_DEPLOYMENT_ID,
        apiVersion: AZURE_OPENAI_ANALYSIS_API_VERSION
      }
    };
    
    handleTwilioConnection(ws, aiConfig);
    
    // Update the call status to CONNECTED in MongoDB when WebSocket connects
    ws.on("message", async (data: RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.event === "start" && msg.start?.callSid) {
          await updateCandidateInterviewStatus(msg.start.callSid, CallStatus.CONNECTED);
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    });
  } else {
    console.log(`Unknown connection type: ${type}`);
    ws.close();
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Public URL: ${PUBLIC_URL}`);
});
