import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import cors from "cors";
import { CorsOptions } from "cors";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import {
  handleCallConnection,
  handleFrontendConnection,
  updateCustomerInfo,
} from "./sessionManager";
import functions from "./functionHandlers";
import {
  session,
  jsonSend,
  closeAllConnections
} from "./callUtils";
import { createInterviewRecord, updateInterviewRecord, getInterviewRecord, connectToDatabase } from "./db";
import { uploadFileToS3, getSignedFileUrl, getFileFromS3 } from "./s3Utils";

dotenv.config();

const PORT = parseInt(process.env.PORT || "8001", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-realtime-preview-2024-12-17";

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

const app = express();
// Configure CORS to allow requests from the frontend
const corsOptions: CorsOptions = {
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only PDF and Word documents
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and Word documents are allowed.') as any);
    }
  }
});

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

// Public URL endpoint
app.get("/public-url", (req, res) => {
  res.json({ publicUrl: PUBLIC_URL });
});


app.get('/health', (req, res) => {
  res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      service: 'tatkal-pulse-websocket-server'
  });
});



// TwiML endpoint
app.all("/twiml", (req, res) => {
  const wsUrl = new URL(PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;

  const twimlContent = twimlTemplate.replace("{{WS_URL}}", wsUrl.toString());
  res.type("text/xml").send(twimlContent);
});

// Hangup endpoint
app.all("/hangup", (req, res) => {
  console.log("HANGUP ENDPOINT CALLED - FORCIBLY ENDING CALL");
  
  // Store the callSid before closing connections
  const callSid = session.streamSid;
  
  // Force close all connections
  if (session.twilioConn && session.streamSid) {
    console.log(`Sending close event for stream ${session.streamSid}`);
    try {
      jsonSend(session.twilioConn, {
        event: "close",
        streamSid: session.streamSid
      });
    } catch (error) {
      console.error("Error sending close event:", error);
    }
  }
  
  // Close all connections
  closeAllConnections();
  
  // Trigger call analysis if we have a callSid
  if (callSid) {
    try {
      console.log(`[WS-ANALYSIS] Starting call analysis process for callSid: ${callSid}`);
      console.log(`[WS-ANALYSIS] Session data before clearing:`, {
        customerName: session.customerName,
        customerLocation: session.customerLocation,
        customerProduct: session.customerProduct,
        streamSid: session.streamSid
      });
      
      // Find the interview record by callSid
      (async () => {
        try {
          console.log(`[WS-ANALYSIS] Connecting to database to find record for callSid: ${callSid}`);
          const { collection } = await connectToDatabase();
          const record = await collection.findOne({ "metadata.callSid": callSid } as any);
          
          if (record) {
            const recordId = record._id.toString();
            console.log(`[WS-ANALYSIS] Found interview record with ID: ${recordId} for callSid: ${callSid}`);
            console.log(`[WS-ANALYSIS] Record details:`, {
              status: record.status,
              candidateName: record.candidateInfo?.name || 'Unknown',
              createdAt: record.createdAt,
              hasTranscript: !!record.screeningInfo?.transcript
            });
            
            // Trigger the analyze-call API
            console.log(`[WS-ANALYSIS] Triggering analyze-call API for interview ID: ${recordId}`);
            
            const response = await fetch("http://localhost:3000/api/analyze-call", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                interviewId: recordId,
              }),
            });
            
            if (response.ok) {
              const result = await response.json();
              console.log(`[WS-ANALYSIS] Successfully triggered call analysis from websocket server`);
              console.log(`[WS-ANALYSIS] Analysis decision: ${result.decision || 'Unknown'}`);
              console.log(`[WS-ANALYSIS] Analysis length: ${result.analysis ? result.analysis.length : 0} characters`);
              
              // Log a preview of the analysis
              if (result.analysis) {
                console.log(`[WS-ANALYSIS] Analysis preview: ${result.analysis.substring(0, 100)}...`);
              }
            } else {
              const errorText = await response.text();
              console.error(`[WS-ANALYSIS] Error triggering call analysis (${response.status}):`, errorText);
            }
          } else {
            console.log(`[WS-ANALYSIS] No interview record found for callSid: ${callSid}`);
          }
        } catch (error) {
          console.error("[WS-ANALYSIS] Error triggering call analysis from websocket server:", error);
        }
      })();
    } catch (error) {
      console.error("[WS-ANALYSIS] Error in call analysis trigger:", error);
    }
  } else {
    console.log("[WS-ANALYSIS] No callSid available, skipping call analysis");
  }
  
  // Return a TwiML response with a Hangup verb
  const hangupTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;
  
  res.type("text/xml").send(hangupTwiml);
});

// Tools endpoint
app.get("/tools", (req, res) => {
  res.json(functions.map((f) => f.schema));
});

// Customer info endpoint
app.post("/customer-info", (req, res) => {
  const handleCustomerInfo = async () => {
    try {
      const { name, location, product, cvReferenceId, cvFileName, cvExtractedInfo, existingId } = req.body;
      
      // Update session with customer info
      updateCustomerInfo(name, location, product);
      
      let result;
      
      // If existingId is provided, update the existing record instead of creating a new one
      if (existingId) {
        try {
          // First, get the existing record to ensure it exists
          const existingRecord = await getInterviewRecord(existingId);
          
          // Update the existing record with new call information
          result = await updateInterviewRecord(existingId, {
            customerName: name,
            customerLocation: location,
            customerProduct: product,
            callSid: session.streamSid || null,
            status: 'initiated',
            cvReferenceId,
            cvFileName,
            cvExtractedInfo
          });
          
          console.log(`Updated existing record with ID: ${existingId}`);
        } catch (error) {
          console.error("Error updating existing record:", error);
          // If update fails, fall back to creating a new record
          const interviewData = {
            customerName: name,
            customerLocation: location,
            customerProduct: product,
            callSid: session.streamSid || null,
            status: 'initiated',
            cvReferenceId,
            cvFileName,
            cvExtractedInfo
          };
          
          result = await createInterviewRecord(interviewData);
        }
      } else {
        // Create a new record in MongoDB
        const interviewData = {
          customerName: name,
          customerLocation: location,
          customerProduct: product,
          callSid: session.streamSid || null,
          status: 'initiated',
          cvReferenceId,
          cvFileName,
          cvExtractedInfo
        };
        
        result = await createInterviewRecord(interviewData);
      }
      
      // Return the _id to be stored in the UI
      res.json({ 
        success: true, 
        collectionId: result._id // Using collectionId in the response for backward compatibility
      });
    } catch (error) {
      console.error("Error updating customer info:", error);
      res.status(500).json({ error: "Failed to update customer information" });
    }
  };
  
  handleCustomerInfo();
});

// Update interview endpoint
app.post("/update-interview", (req, res) => {
  const handleUpdateInterview = async () => {
    try {
      const { collectionId, data, findByCallSid } = req.body;
      
      let result;
      
      if (findByCallSid && data && data.callSid) {
        // Find the record by callSid and update it
        try {
          const { collection } = await connectToDatabase();
          const record = await collection.findOne({ callSid: data.callSid } as any);
          
          if (record) {
            // Use the _id from the found record
            // Convert ObjectId to string if needed
            const recordId = typeof record._id === 'string' ? record._id : record._id.toString();
            result = await updateInterviewRecord(recordId, data);
          } else {
            return res.status(404).json({ error: "No record found with the provided callSid" });
          }
        } catch (dbError) {
          console.error("Error finding record by callSid:", dbError);
          return res.status(500).json({ error: "Failed to find record by callSid" });
        }
      } else if (collectionId) {
        // Normal update by id (previously collectionId)
        result = await updateInterviewRecord(collectionId, data);
      } else {
        return res.status(400).json({ error: "Either collectionId or findByCallSid with callSid is required" });
      }
      
      res.json({ 
        success: true, 
        record: result 
      });
    } catch (error) {
      console.error("Error updating interview record:", error);
      res.status(500).json({ error: "Failed to update interview record" });
    }
  };
  
  handleUpdateInterview();
});

// Get interview endpoint
app.get("/interview/:collectionId", (req, res) => {
  const handleGetInterview = async () => {
    try {
      const { collectionId } = req.params;
      
      if (!collectionId) {
        return res.status(400).json({ error: "Collection ID is required" });
      }
      
      const record = await getInterviewRecord(collectionId);
      
      res.json({ 
        success: true, 
        record 
      });
    } catch (error) {
      console.error("Error retrieving interview record:", error);
      res.status(500).json({ error: "Failed to retrieve interview record" });
    }
  };
  
  handleGetInterview();
});

// Bulk CV upload endpoint
app.post("/cv/bulk-upload", upload.single('file'), (req, res) => {
  const handleBulkUpload = async () => {
    try {
      console.log("[CV-BULK-UPLOAD] Processing file upload request");
      
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }
      
      const file = req.file;
      console.log(`[CV-BULK-UPLOAD] Received file: ${file.originalname}, size: ${file.size} bytes, type: ${file.mimetype}`);
      
      // Upload file to S3
      const { key, url } = await uploadFileToS3(
        file.buffer,
        file.originalname,
        file.mimetype
      );
      
      // Generate a reference ID for tracking
      const referenceId = uuidv4();
      
      // Extract information from CV (mock implementation)
      const extractedInfo = {
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        uploadTimestamp: new Date().toISOString(),
        s3Key: key,
        s3Url: url
      };
      
      console.log(`[CV-BULK-UPLOAD] File uploaded successfully to S3 with key: ${key}`);
      
      // Return the response
      res.status(200).json({
        success: true,
        referenceId,
        s3Key: key,
        s3Url: url,
        fileName: file.originalname,
        extractedInfo
      });
    } catch (error) {
      console.error("[CV-BULK-UPLOAD] Error processing file upload:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ 
        error: "Failed to process file upload", 
        details: errorMessage 
      });
    }
  };
  
  handleBulkUpload();
});

// Download CV by name endpoint
app.get("/cv/download-by-name", (req, res) => {
  const handleDownloadByName = async () => {
    try {
      const { name } = req.query;
      
      if (!name || typeof name !== 'string') {
        console.error(`[CV-DOWNLOAD] Missing or invalid name parameter`);
        return res.status(400).json({ error: "Name parameter is required" });
      }
    
    console.log(`[CV-DOWNLOAD] Searching for CV with name: ${name}`);
    
    // Connect to the database
    console.log(`[CV-DOWNLOAD] Connecting to database`);
    const { collection } = await connectToDatabase();
    console.log(`[CV-DOWNLOAD] Successfully connected to database`);
    
    // Search for CVs in the S3 bucket
    // In a real implementation, you would query a database that maps names to CV files
    // For this implementation, we'll assume CVs are stored with a naming convention that includes the name
    
    // List objects in the S3 bucket with the prefix "cvs/"
    console.log(`[CV-DOWNLOAD] Importing AWS S3 SDK`);
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-south-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    
    const BUCKET_NAME = process.env.AWS_S3_BUCKET || 'hr-cv-storage-dev';
    console.log(`[CV-DOWNLOAD] Using S3 bucket: ${BUCKET_NAME}`);
    
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'cvs/',
    });
    
    console.log(`[CV-DOWNLOAD] Listing objects in S3 bucket with prefix 'cvs/'`);
    const listResponse = await s3Client.send(listCommand);
    
    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      console.error(`[CV-DOWNLOAD] No CVs found in S3 bucket ${BUCKET_NAME}`);
      return res.status(404).json({ error: "No CVs found in storage" });
    }
    
    console.log(`[CV-DOWNLOAD] Found ${listResponse.Contents.length} objects in S3 bucket`);
    
    // Find a CV that matches the name
    console.log(`[CV-DOWNLOAD] Searching for CV matching name: ${name}`);
    const matchingCV = listResponse.Contents.find(item => {
      const key = item.Key || '';
      const fileName = key.split('/').pop() || '';
      
      // Try different matching strategies
      // 1. Exact match
      if (fileName === name) {
        console.log(`[CV-DOWNLOAD] Found exact match for CV: ${key}`);
        return true;
      }
      
      // 2. Case-insensitive match
      if (fileName.toLowerCase() === name.toLowerCase()) {
        console.log(`[CV-DOWNLOAD] Found case-insensitive match for CV: ${key}`);
        return true;
      }
      
      // 3. Filename contains the name (case insensitive)
      if (fileName.toLowerCase().includes(name.toLowerCase())) {
        console.log(`[CV-DOWNLOAD] Found partial match for CV: ${key}`);
        return true;
      }
      
      // 4. Try with normalized name (spaces replaced with underscores)
      const normalizedName = name.toLowerCase().replace(/\s+/g, '_');
      if (fileName.toLowerCase().includes(normalizedName)) {
        console.log(`[CV-DOWNLOAD] Found match with normalized name for CV: ${key}`);
        return true;
      }
      
      // 5. Try with normalized filename (underscores replaced with spaces)
      const denormalizedFileName = fileName.toLowerCase().replace(/_+/g, ' ');
      if (denormalizedFileName.includes(name.toLowerCase())) {
        console.log(`[CV-DOWNLOAD] Found match with denormalized filename for CV: ${key}`);
        return true;
      }
      
      return false;
    });
    
    if (!matchingCV || !matchingCV.Key) {
      console.error(`[CV-DOWNLOAD] No matching CV found for name: ${name}`);
      return res.status(404).json({ error: `No CV found for name: ${name}` });
    }
    
    // Get the CV file from S3
    console.log(`[CV-DOWNLOAD] Retrieving CV file from S3: ${matchingCV.Key}`);
    const cvBuffer = await getFileFromS3(matchingCV.Key);
    console.log(`[CV-DOWNLOAD] Successfully retrieved CV file, size: ${cvBuffer.length} bytes`);
    
    // Get the file extension to determine content type
    const fileName = matchingCV.Key.split('/').pop() || '';
    const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
    
    let contentType = 'application/octet-stream';
    if (fileExtension === 'pdf') {
      contentType = 'application/pdf';
    } else if (fileExtension === 'doc') {
      contentType = 'application/msword';
    } else if (fileExtension === 'docx') {
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    console.log(`[CV-DOWNLOAD] Determined content type: ${contentType} for file: ${fileName}`);
    
    // Generate a signed URL for the CV
    console.log(`[CV-DOWNLOAD] Generating signed URL for CV: ${matchingCV.Key}`);
    const signedUrl = await getSignedFileUrl(matchingCV.Key);
    console.log(`[CV-DOWNLOAD] Successfully generated signed URL`);
    
      // Return the CV information
      console.log(`[CV-DOWNLOAD] Returning CV information for ${fileName}`);
      res.status(200).json({
        success: true,
        fileName,
        fileSize: cvBuffer.length,
        contentType,
        s3Key: matchingCV.Key,
        s3Url: signedUrl
      });
    } catch (error) {
      console.error("[CV-DOWNLOAD] Error downloading CV by name:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ 
        error: "Failed to download CV", 
        details: errorMessage 
      });
    }
  };
  
  handleDownloadByName();
});

// WebSocket connection handling
let currentCall: WebSocket | null = null;
let currentLogs: WebSocket | null = null;

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 1) {
    ws.close();
    return;
  }

  const type = parts[0];

  if (type === "call") {
    if (currentCall) currentCall.close();
    currentCall = ws;
    handleCallConnection(currentCall, OPENAI_API_KEY);
  } else if (type === "logs") {
    if (currentLogs) currentLogs.close();
    currentLogs = ws;
    handleFrontendConnection(currentLogs);
  } else {
    ws.close();
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
