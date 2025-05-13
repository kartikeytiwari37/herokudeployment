import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import { Readable } from 'stream';

// Load environment variables
dotenv.config();

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Create S3 service object
const s3 = new AWS.S3();

/**
 * Upload a file to S3
 * @param file The file to upload
 * @returns Promise with upload result
 */
export async function uploadFileToS3(file: Express.Multer.File): Promise<AWS.S3.ManagedUpload.SendData> {
  try {
    const params: AWS.S3.PutObjectRequest = {
      Bucket: process.env.AWS_S3_BUCKET || '',
      Key: file.originalname, // Preserve original file name
      Body: file.buffer,
      ContentType: file.mimetype
    };

    console.log(`Uploading file: ${file.originalname} (${file.size} bytes)`);
    
    return await s3.upload(params).promise();
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    throw error;
  }
}

/**
 * Upload multiple files to S3
 * @param files Array of files to upload
 * @returns Promise with array of upload results
 */
export async function uploadMultipleFilesToS3(files: Express.Multer.File[]): Promise<AWS.S3.ManagedUpload.SendData[]> {
  try {
    console.log(`Uploading ${files.length} files to S3...`);
    
    // Upload all files in parallel
    const uploadPromises = files.map(file => uploadFileToS3(file));
    
    return await Promise.all(uploadPromises);
  } catch (error) {
    console.error('Error uploading multiple files to S3:', error);
    throw error;
  }
}

/**
 * Check if S3 is configured properly
 * @returns Boolean indicating if S3 is configured
 */
export function isS3Configured(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION &&
    process.env.AWS_S3_BUCKET
  );
}
