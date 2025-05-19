import { MongoClient, Collection, Db, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// MongoDB connection string and database name
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'interview_db';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'candidateInterviews';
const BULK_RECORDS_COLLECTION = 'bulk_records';

// Call status enum
export enum CallStatus {
  INITIATED = 'INITIATED',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED'
}

// Bulk record status enum
export enum BulkRecordStatus {
  INSUFFICIENT_INFO = 'INSUFFICIENT_INFO',
  PENDING = 'PENDING',
  CALL_INITIATED = 'CALL_INITIATED'
}

// MongoDB client
let client: MongoClient;
let db: Db;
let candidateInterviews: Collection;
let bulkRecords: Collection;

/**
 * Connect to MongoDB
 */
export async function connectToMongoDB() {
  try {
    if (!MONGODB_URI) {
      console.error('MONGODB_URI environment variable is not set');
      return;
    }

    console.log('Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    db = client.db(MONGODB_DB);
    candidateInterviews = db.collection(MONGODB_COLLECTION);
    bulkRecords = db.collection(BULK_RECORDS_COLLECTION);
    
    console.log(`Connected to MongoDB: ${MONGODB_DB}.${MONGODB_COLLECTION} and ${BULK_RECORDS_COLLECTION}`);
    return true;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    return false;
  }
}

/**
 * Create a new candidate interview record
 */
export async function createCandidateInterview(callSid: string, candidateInfo: any, jobDetails: any) {
  try {
    if (!candidateInterviews) {
      console.error('MongoDB collection not initialized');
      return null;
    }

    const now = new Date();
    
    const document = {
      _id: callSid,
      candidateInfo,
      jobDetails,
      status: CallStatus.INITIATED,
      createdAt: now,
      updatedAt: now
    };

    // @ts-ignore - We're using string IDs instead of ObjectId
    await candidateInterviews.insertOne(document);
    console.log(`Created candidate interview record for call SID: ${callSid}`);
    return document;
  } catch (error) {
    console.error('Error creating candidate interview record:', error);
    return null;
  }
}

/**
 * Update candidate interview status
 */
export async function updateCandidateInterviewStatus(callSid: string, status: CallStatus) {
  try {
    if (!candidateInterviews) {
      console.error('MongoDB collection not initialized');
      return false;
    }

    const result = await candidateInterviews.updateOne(
      { _id: callSid } as any,
      { 
        $set: { 
          status,
          updatedAt: new Date()
        } 
      }
    );

    console.log(`Updated status for call SID ${callSid} to ${status}`);
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error updating candidate interview status:', error);
    return false;
  }
}

/**
 * Update candidate interview with transcript and analysis
 */
export async function updateCandidateInterviewWithTranscript(
  callSid: string, 
  transcript: string, 
  analysis: string,
  callMetrics?: any
) {
  try {
    if (!candidateInterviews) {
      console.error('MongoDB collection not initialized');
      return false;
    }

    // Extract decision and remarks from analysis
    const decision = extractDecisionFromAnalysis(analysis);
    const remarks = extractRemarksFromAnalysis(analysis);

    // Prepare update object
    const updateObj: any = { 
      'screeningInfo.transcript': transcript,
      'screeningInfo.analysis': analysis,
      'screeningInfo.decision': decision,
      'screeningInfo.remarks': remarks,
      status: CallStatus.COMPLETED,
      updatedAt: new Date()
    };

    // Add metrics if provided
    if (callMetrics) {
      updateObj['screeningInfo.metrics'] = callMetrics;
    }

    const result = await candidateInterviews.updateOne(
      { _id: callSid } as any,
      { $set: updateObj }
    );

    console.log(`Updated transcript and analysis for call SID: ${callSid}`);
    if (callMetrics) {
      console.log(`Also saved metrics for call SID: ${callSid}`);
    }
    
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error updating candidate interview with transcript:', error);
    return false;
  }
}

/**
 * Get candidate interview by call SID
 */
export async function getCandidateInterview(callSid: string) {
  try {
    if (!candidateInterviews) {
      console.error('MongoDB collection not initialized');
      return null;
    }

    const document = await candidateInterviews.findOne({ _id: callSid } as any);
    return document;
  } catch (error) {
    console.error('Error getting candidate interview:', error);
    return null;
  }
}

/**
 * Search candidate interviews by status with pagination
 * @param status Optional status filter
 * @param page Page number (starting from 1)
 * @param limit Number of records per page
 * @returns Object containing total count and array of candidate interviews
 */
export async function searchCandidateInterviews(
  status?: typeof CallStatus[keyof typeof CallStatus],
  page: number = 1,
  limit: number = 10
) {
  try {
    if (!candidateInterviews) {
      console.error('MongoDB collection not initialized');
      return { total: 0, interviews: [] };
    }

    // Create filter based on status
    const filter = status ? { status } : {};
    
    // Calculate skip value for pagination
    const skip = (page - 1) * limit;
    
    // Get total count
    const total = await candidateInterviews.countDocuments(filter);
    
    // Get paginated results
    const interviews = await candidateInterviews
      .find(filter)
      .sort({ createdAt: -1 }) // Sort by creation date, newest first
      .skip(skip)
      .limit(limit)
      .toArray();
    
    console.log(`Found ${interviews.length} candidate interviews with filter:`, filter);
    
    return {
      total,
      interviews,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    console.error('Error searching candidate interviews:', error);
    return { total: 0, interviews: [] };
  }
}

/**
 * Extract decision (GO/NO GO) from analysis
 */
function extractDecisionFromAnalysis(analysis: string): string {
  try {
    console.log('Extracting decision from analysis...');
    
    // Look for the hiring recommendation section with improved pattern matching
    const recommendationPatterns = [
      // Pattern 1: HIRING RECOMMENDATION: followed by text
      /HIRING RECOMMENDATION[:\s]*[\r\n]*(.*?)(?:[\r\n]|$)/i,
      
      // Pattern 2: Recommendation: followed by text
      /Recommendation[:\s]*(.*?)(?:[\r\n]|$)/i,
      
      // Pattern 3: Numbered recommendation (e.g., "8. HIRING RECOMMENDATION: NO GO")
      /\d+\.\s*HIRING RECOMMENDATION[:\s]*[\r\n]*(.*?)(?:[\r\n]|$)/i,
      
      // Pattern 4: Bold recommendation (e.g., "**Recommendation**: NO GO")
      /\*\*(?:HIRING )?RECOMMENDATION\*\*[:\s]*(.*?)(?:[\r\n]|$)/i
    ];
    
    // Try each pattern
    for (const pattern of recommendationPatterns) {
      const match = analysis.match(pattern);
      if (match && match[1]) {
        const recommendationText = match[1].trim();
        console.log(`Found recommendation text: "${recommendationText}"`);
        
        // Check for NO GO (check this first as it contains GO)
        if (recommendationText.toUpperCase().includes('NO GO')) {
          console.log('Decision extracted: NO GO');
          return 'NO GO';
        } 
        // Check for GO
        else if (recommendationText.toUpperCase().includes('GO')) {
          console.log('Decision extracted: GO');
          return 'GO';
        }
      }
    }
    
    // If no match found with the patterns above, search the entire text for GO/NO GO
    if (analysis.toUpperCase().includes('NO GO')) {
      console.log('Decision extracted from full text: NO GO');
      return 'NO GO';
    } else if (analysis.toUpperCase().includes('GO') && !analysis.toUpperCase().includes('NO GO')) {
      console.log('Decision extracted from full text: GO');
      return 'GO';
    }
    
    console.log('No decision found, returning UNDETERMINED');
    return 'UNDETERMINED';
  } catch (error) {
    console.error('Error extracting decision from analysis:', error);
    return 'UNDETERMINED';
  }
}

/**
 * Extract remarks from analysis
 */
function extractRemarksFromAnalysis(analysis: string): string {
  try {
    console.log('Extracting remarks from analysis...');
    
    // Define patterns to look for justification or remarks
    const remarkPatterns = [
      // Pattern 1: Justification: followed by text
      /Justification[:\s]*(.*?)(?:[\r\n](?:\s*[\r\n]|$)|$)/is,
      
      // Pattern 2: Overall candidate evaluation: followed by text
      /Overall candidate evaluation[:\s]*(.*?)(?:[\r\n](?:\s*[\r\n]|$)|$)/is,
      
      // Pattern 3: Numbered justification (e.g., "8. HIRING RECOMMENDATION: NO GO\nJustification: text")
      /HIRING RECOMMENDATION[:\s]*.*?[\r\n]+\s*Justification[:\s]*(.*?)(?:[\r\n](?:\s*[\r\n]|$)|$)/is,
      
      // Pattern 4: Bold justification (e.g., "**Justification**: text")
      /\*\*Justification\*\*[:\s]*(.*?)(?:[\r\n](?:\s*[\r\n]|$)|$)/is,
      
      // Pattern 5: Text after recommendation (e.g., "Recommendation: NO GO - text")
      /Recommendation[:\s]*(?:GO|NO GO)[:\s-]*(.*?)(?:[\r\n](?:\s*[\r\n]|$)|$)/is
    ];
    
    // Try each pattern
    for (const pattern of remarkPatterns) {
      const match = analysis.match(pattern);
      if (match && match[1]) {
        const remarkText = match[1].trim();
        console.log(`Found remarks: "${remarkText.substring(0, 50)}..."`);
        return remarkText;
      }
    }
    
    // If no match found with the patterns above, look for text after the recommendation
    const recommendationIndex = analysis.toUpperCase().indexOf('NO GO');
    if (recommendationIndex !== -1) {
      // Get text after "NO GO"
      const textAfterRecommendation = analysis.substring(recommendationIndex + 5).trim();
      const firstSentence = textAfterRecommendation.split(/[.!?][\s\n]/)[0];
      
      if (firstSentence && firstSentence.length > 10) {
        console.log(`Found remarks after NO GO: "${firstSentence}"`);
        return firstSentence + '.';
      }
    }
    
    // If still nothing, try to find a section that looks like a conclusion or summary
    const conclusionPatterns = [
      /In conclusion[,:\s]*(.*?)(?:[\r\n](?:\s*[\r\n]|$)|$)/is,
      /Summary[:\s]*(.*?)(?:[\r\n](?:\s*[\r\n]|$)|$)/is,
      /Overall[,:\s]*(.*?)(?:[\r\n](?:\s*[\r\n]|$)|$)/is
    ];
    
    for (const pattern of conclusionPatterns) {
      const match = analysis.match(pattern);
      if (match && match[1]) {
        const conclusionText = match[1].trim();
        console.log(`Found conclusion: "${conclusionText.substring(0, 50)}..."`);
        return conclusionText;
      }
    }
    
    // If still nothing, return a portion of the analysis
    const lines = analysis.split('\n').filter(line => line.trim() !== '');
    if (lines.length > 5) {
      const relevantLines = lines.slice(0, 5).join('\n');
      console.log(`Using first 5 lines as remarks`);
      return relevantLines;
    }
    
    console.log(`Using first 200 characters as remarks`);
    return analysis.substring(0, 200) + '...';
  } catch (error) {
    console.error('Error extracting remarks from analysis:', error);
    return 'No remarks available';
  }
}

/**
 * Create a new bulk record
 */
export async function createBulkRecord(candidateData: any) {
  try {
    if (!bulkRecords) {
      console.error('MongoDB bulk_records collection not initialized');
      return null;
    }

    const now = new Date();
    
    // Determine status based on data completeness
    const status = isCandidateDataComplete(candidateData) 
      ? BulkRecordStatus.PENDING 
      : BulkRecordStatus.INSUFFICIENT_INFO;
    
    const document = {
      ...candidateData,
      status,
      createdAt: now,
      updatedAt: now
    };

    const result = await bulkRecords.insertOne(document);
    console.log(`Created bulk record with ID: ${result.insertedId}`);
    return { ...document, _id: result.insertedId };
  } catch (error) {
    console.error('Error creating bulk record:', error);
    return null;
  }
}

/**
 * Update a bulk record with CV information
 */
export async function updateBulkRecordWithCVInfo(recordId: string, cvInfo: any) {
  try {
    if (!bulkRecords) {
      console.error('MongoDB bulk_records collection not initialized');
      return false;
    }

    const result = await bulkRecords.updateOne(
      { _id: new ObjectId(recordId) },
      { 
        $set: { 
          cvInfo,
          updatedAt: new Date()
        } 
      }
    );

    console.log(`Updated bulk record ${recordId} with CV info`);
    
    // Check if the record is now complete after adding CV info
    const updatedRecord = await bulkRecords.findOne({ _id: new ObjectId(recordId) });
    if (updatedRecord && isCandidateDataComplete(updatedRecord)) {
      await bulkRecords.updateOne(
        { _id: new ObjectId(recordId) },
        { 
          $set: { 
            status: BulkRecordStatus.PENDING,
            updatedAt: new Date()
          } 
        }
      );
      console.log(`Updated bulk record ${recordId} status to PENDING`);
    }
    
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error updating bulk record with CV info:', error);
    return false;
  }
}

/**
 * Get all bulk records
 */
export async function getAllBulkRecords() {
  try {
    if (!bulkRecords) {
      console.error('MongoDB bulk_records collection not initialized');
      return [];
    }

    return await bulkRecords.find().toArray();
  } catch (error) {
    console.error('Error getting bulk records:', error);
    return [];
  }
}

/**
 * Search bulk records by status with pagination
 * @param status Optional status filter
 * @param page Page number (starting from 1)
 * @param limit Number of records per page
 * @returns Object containing total count and array of bulk records
 */
export async function searchBulkRecords(
  status?: typeof BulkRecordStatus[keyof typeof BulkRecordStatus],
  page: number = 1,
  limit: number = 10
) {
  try {
    if (!bulkRecords) {
      console.error('MongoDB bulk_records collection not initialized');
      return { total: 0, records: [] };
    }

    // Create filter based on status
    const filter = status ? { status } : {};
    
    // Calculate skip value for pagination
    const skip = (page - 1) * limit;
    
    // Get total count
    const total = await bulkRecords.countDocuments(filter);
    
    // Get paginated results
    const records = await bulkRecords
      .find(filter)
      .sort({ createdAt: -1 }) // Sort by creation date, newest first
      .skip(skip)
      .limit(limit)
      .toArray();
    
    console.log(`Found ${records.length} bulk records with filter:`, filter);
    
    return {
      total,
      records,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    console.error('Error searching bulk records:', error);
    return { total: 0, records: [] };
  }
}

/**
 * Get bulk record by ID
 */
export async function getBulkRecordById(recordId: string) {
  try {
    if (!bulkRecords) {
      console.error('MongoDB bulk_records collection not initialized');
      return null;
    }

    return await bulkRecords.findOne({ _id: new ObjectId(recordId) });
  } catch (error) {
    console.error('Error getting bulk record by ID:', error);
    return null;
  }
}

/**
 * Get a pending bulk record for calling
 */
export async function getPendingBulkRecord() {
  try {
    if (!bulkRecords) {
      console.error('MongoDB bulk_records collection not initialized');
      return null;
    }

    // Find a record with PENDING status
    const record = await bulkRecords.findOne({ status: BulkRecordStatus.PENDING });
    
    if (!record) {
      console.log('No pending bulk records found');
      return null;
    }
    
    console.log(`Found pending bulk record with ID: ${record._id}`);
    return record;
  } catch (error) {
    console.error('Error getting pending bulk record:', error);
    return null;
  }
}

/**
 * Update bulk record with call SID and status
 */
export async function updateBulkRecordWithCallSid(recordId: string, callSid: string) {
  try {
    if (!bulkRecords) {
      console.error('MongoDB bulk_records collection not initialized');
      return false;
    }

    const result = await bulkRecords.updateOne(
      { _id: new ObjectId(recordId) },
      { 
        $set: { 
          callSid,
          status: BulkRecordStatus.CALL_INITIATED,
          updatedAt: new Date()
        } 
      }
    );

    console.log(`Updated bulk record ${recordId} with call SID ${callSid} and status CALL_INITIATED`);
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error updating bulk record with call SID:', error);
    return false;
  }
}

/**
 * Check if candidate data is complete
 */
function isCandidateDataComplete(candidateData: any): boolean {
  // Check if all required fields are present and not empty
  return !!(
    candidateData.name &&
    candidateData.location &&
    candidateData.product &&
    candidateData.designation &&
    candidateData.phoneNumber &&
    candidateData.cvInfo &&
    candidateData.cvInfo.extractedInfo
  );
}

// Initialize MongoDB connection
connectToMongoDB().catch(console.error);
