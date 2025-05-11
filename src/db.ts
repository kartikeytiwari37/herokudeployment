import { MongoClient, Collection, ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { InterviewStatus } from './interview-status';

dotenv.config();

// MongoDB connection string and database details
const uri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || 'interview_db';
const collectionName = process.env.MONGODB_COLLECTION || 'candidateInterviews';

// MongoDB client instance
let client: MongoClient | null = null;
let collection: Collection | null = null;

/**
 * Initialize the MongoDB connection
 */
export async function connectToDatabase() {
  if (!uri) {
    throw new Error('MongoDB URI is not defined in environment variables');
  }

  try {
    client = new MongoClient(uri);
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(dbName);
    collection = db.collection(collectionName);
    
    return { client, collection };
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    throw error;
  }
}

/**
 * Close the MongoDB connection
 */
export async function closeConnection() {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
    client = null;
    collection = null;
  }
}

/**
 * Create a new interview record in the database
 * @param data Interview data to save
 * @returns The created document
 */
export async function createInterviewRecord(data: any) {
  if (!collection) {
    await connectToDatabase();
  }

  if (!collection) {
    throw new Error('Failed to connect to MongoDB collection');
  }

  try {
    // Format the data according to the desired schema
    const now = new Date();
    const formattedDate = now.toISOString().replace('Z', '+05:30');
    
    // Generate a UUID for the _id
    const id = uuidv4();
    
    // Extract data from the input
    const { customerName, customerLocation, customerProduct, phoneNumber, ...otherData } = data;
    
    // Create the base metadata
    const metadata: Record<string, any> = {
      createdBy: 'System',
      updatedBy: 'System',
      source: 'Voice Platform'
    };
    
    // Add callSid to metadata if it exists
    if (otherData.callSid) {
      metadata.callSid = otherData.callSid;
    }
    
    // Create the document with the proper schema
    const document = {
      _id: id,
      candidateInfo: {
        name: customerName || 'Unknown',
        phoneNumber: phoneNumber || 'Unknown',
        currentLocation: customerLocation || 'Unknown'
      },
      jobDetails: {
        location: customerLocation || 'Unknown',
        requiredProduct: customerProduct || 'Unknown',
        designation: 'Field Sales Executive'
      },
      screeningInfo: {
        transcript: '',
        decision: '',
        remarks: '',
        rejectionReason: '',
        analysis: ''
      },
      cvInfo: {
        referenceId: otherData.cvReferenceId || '',
        fileName: otherData.cvFileName || '',
        extractedInfo: otherData.cvExtractedInfo || null
      },
      status: InterviewStatus.PENDING,
      interviewTime: formattedDate,
      createdAt: formattedDate,
      updatedAt: formattedDate,
      metadata: metadata,
    // Include any other data that was passed in but exclude callSid and CV-related fields from top level
    ...Object.entries(otherData)
      .filter(([key]) => !['callSid', 'cvReferenceId', 'cvFileName', 'cvExtractedInfo'].includes(key))
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
    };
    
    // Insert the document - use type assertion to bypass TypeScript's type checking
    const result = await collection.insertOne(document as any);
    
    if (result.acknowledged) {
      console.log(`Interview record created with ID: ${id}`);
      return document;
    } else {
      throw new Error('Failed to insert document');
    }
  } catch (error) {
    console.error('Error creating interview record:', error);
    throw error;
  }
}

/**
 * Update an existing interview record
 * @param id The ID of the record to update
 * @param data The data to update
 * @returns The updated document
 */
export async function updateInterviewRecord(id: string, data: any) {
  if (!collection) {
    await connectToDatabase();
  }

  if (!collection) {
    throw new Error('Failed to connect to MongoDB collection');
  }

  try {
    // Format the update data according to the schema
    const now = new Date();
    const formattedDate = now.toISOString().replace('Z', '+05:30');
    const updateData: any = { updatedAt: formattedDate };
    
    // Extract data from the input
    const { 
      status, 
      callSid, 
      customerName, 
      customerLocation, 
      customerProduct,
      transcript,
      decision,
      remarks,
      rejectionReason,
      analysis,
      cvReferenceId,
      cvFileName,
      cvExtractedInfo
    } = data;
    
    // Update specific fields based on what was provided
    if (status) {
      // Validate status if provided
      if (typeof status === 'string' && !Object.values(InterviewStatus).includes(status as InterviewStatus)) {
        console.warn(`Invalid status: ${status}. Using ERROR status instead.`);
        updateData.status = InterviewStatus.ERROR;
      } else {
        updateData.status = status;
      }
    }
    
    if (callSid) {
      updateData['metadata.callSid'] = callSid;
    }
    
    if (customerName) {
      updateData['candidateInfo.name'] = customerName;
    }
    
    if (customerLocation) {
      updateData['candidateInfo.currentLocation'] = customerLocation;
      updateData['jobDetails.location'] = customerLocation;
    }
    
    if (customerProduct) {
      updateData['jobDetails.requiredProduct'] = customerProduct;
    }
    
    if (transcript) {
      updateData['screeningInfo.transcript'] = transcript;
    }
    
    if (decision) {
      updateData['screeningInfo.decision'] = decision;
    }
    
    if (remarks) {
      updateData['screeningInfo.remarks'] = remarks;
    }
    
    if (rejectionReason) {
      updateData['screeningInfo.rejectionReason'] = rejectionReason;
    }
    
    if (analysis) {
      updateData['screeningInfo.analysis'] = analysis;
    }
    
    // Update CV information if provided
    if (cvReferenceId) {
      updateData['cvInfo.referenceId'] = cvReferenceId;
    }
    
    if (cvFileName) {
      updateData['cvInfo.fileName'] = cvFileName;
    }
    
    if (cvExtractedInfo) {
      updateData['cvInfo.extractedInfo'] = cvExtractedInfo;
    }
    
    updateData['metadata.updatedBy'] = 'System';
    
    // Convert ObjectId string to ObjectId if needed
    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (e) {
      // If conversion fails, use the string ID directly
      objectId = id;
    }
    
    // Update the document
    const result = await collection.findOneAndUpdate(
      { _id: objectId } as any, // Type assertion to bypass TypeScript's type checking
      { $set: updateData },
      { returnDocument: 'after' }
    );
    
    if (result) {
      console.log(`Interview record updated: ${id}`);
      return result;
    } else {
      throw new Error(`No record found with _id: ${id}`);
    }
  } catch (error) {
    console.error('Error updating interview record:', error);
    throw error;
  }
}

/**
 * Get an interview record by its ID
 * @param id The ID of the record to retrieve
 * @returns The interview record
 */
export async function getInterviewRecord(id: string) {
  if (!collection) {
    await connectToDatabase();
  }

  if (!collection) {
    throw new Error('Failed to connect to MongoDB collection');
  }

  try {
    // Convert ObjectId string to ObjectId if needed
    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (e) {
      // If conversion fails, use the string ID directly
      objectId = id;
    }
    
    // Find document by ID
    const record = await collection.findOne({ _id: objectId } as any); // Type assertion to bypass TypeScript's type checking
    
    if (record) {
      return record;
    } else {
      throw new Error(`No record found with _id: ${id}`);
    }
  } catch (error) {
    console.error('Error retrieving interview record:', error);
    throw error;
  }
}

// Initialize the database connection when the module is imported
connectToDatabase().catch(console.error);
