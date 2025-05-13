import { parse } from 'csv-parse/sync';
import { createBulkRecord } from './db';
import { processCVByName } from './cvExtractor';

/**
 * Parse CSV data and create bulk records
 * @param csvBuffer Buffer containing CSV data
 * @returns Array of created bulk records
 */
export async function parseCandidateCSV(csvBuffer: Buffer): Promise<any[]> {
  try {
    console.log('Parsing CSV data...');
    
    // Parse CSV data
    const records = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    console.log(`Parsed ${records.length} records from CSV`);
    
    // Process each record
    const results = [];
    
    for (const record of records) {
      try {
        // Validate required fields
        if (!record.Name || !record.Location || !record.Product || !record.Designation || !record['Phone Number']) {
          console.warn('Skipping record with missing required fields:', record);
          continue;
        }
        
        // Create candidate data object
        const candidateData = {
          name: record.Name,
          location: record.Location,
          product: record.Product,
          designation: record.Designation,
          phoneNumber: record['Phone Number'],
          cvFilename: record.CV || null
        };
        
        console.log(`Processing candidate: ${candidateData.name}`);
        
        // Create bulk record
        const bulkRecord = await createBulkRecord(candidateData);
        
        if (!bulkRecord) {
          console.error(`Failed to create bulk record for candidate: ${candidateData.name}`);
          continue;
        }
        
        // Process CV if available
        if (candidateData.cvFilename) {
          console.log(`Processing CV for candidate: ${candidateData.name}, CV: ${candidateData.cvFilename}`);
          
          // Process CV asynchronously
          processCVAndUpdateRecord(bulkRecord._id.toString(), candidateData.cvFilename);
        }
        
        results.push(bulkRecord);
      } catch (recordError) {
        console.error('Error processing CSV record:', recordError);
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error parsing CSV data:', error);
    throw error;
  }
}

/**
 * Process CV and update bulk record asynchronously
 * @param recordId Bulk record ID
 * @param cvFilename CV filename
 */
async function processCVAndUpdateRecord(recordId: string, cvFilename: string): Promise<void> {
  try {
    const { updateBulkRecordWithCVInfo } = await import('./db');
    
    // Process CV
    const cvInfo = await processCVByName(cvFilename);
    
    if (!cvInfo) {
      console.error(`Failed to process CV for record ${recordId}: ${cvFilename}`);
      return;
    }
    
    // Update bulk record with CV info
    const updated = await updateBulkRecordWithCVInfo(recordId, cvInfo);
    
    if (updated) {
      console.log(`Successfully updated record ${recordId} with CV info`);
    } else {
      console.error(`Failed to update record ${recordId} with CV info`);
    }
  } catch (error) {
    console.error(`Error processing CV and updating record ${recordId}:`, error);
  }
}
