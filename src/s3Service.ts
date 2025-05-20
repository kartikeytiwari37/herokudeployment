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
 * @param prefix Optional folder prefix
 * @returns Promise with upload result
 */
export async function uploadFileToS3(file: Express.Multer.File, prefix?: string): Promise<AWS.S3.ManagedUpload.SendData> {
  try {
    const key = prefix ? `${prefix}/${file.originalname}` : file.originalname;
    
    const params: AWS.S3.PutObjectRequest = {
      Bucket: process.env.AWS_S3_BUCKET || '',
      Key: key, // Preserve original file name with optional prefix
      Body: file.buffer,
      ContentType: file.mimetype
    };

    console.log(`Uploading file: ${key} (${file.size} bytes)`);
    
    return await s3.upload(params).promise();
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    throw error;
  }
}

/**
 * Upload a buffer to S3
 * @param buffer The buffer to upload
 * @param key The key (filename) to use in S3
 * @param contentType The content type of the file
 * @param prefix Optional folder prefix
 * @returns Promise with upload result
 */
export async function uploadBufferToS3(
  buffer: Buffer, 
  key: string, 
  contentType: string,
  prefix?: string
): Promise<AWS.S3.ManagedUpload.SendData> {
  try {
    const s3Key = prefix ? `${prefix}/${key}` : key;
    
    const params: AWS.S3.PutObjectRequest = {
      Bucket: process.env.AWS_S3_BUCKET || '',
      Key: s3Key,
      Body: buffer,
      ContentType: contentType
    };

    console.log(`Uploading buffer to S3: ${s3Key} (${buffer.length} bytes)`);
    
    return await s3.upload(params).promise();
  } catch (error) {
    console.error('Error uploading buffer to S3:', error);
    throw error;
  }
}

/**
 * Get a file from S3
 * @param key The key (filename) to get from S3
 * @returns Promise with the file data
 */
export async function getFileFromS3(key: string): Promise<AWS.S3.GetObjectOutput> {
  try {
    const params: AWS.S3.GetObjectRequest = {
      Bucket: process.env.AWS_S3_BUCKET || '',
      Key: key
    };

    console.log(`Getting file from S3: ${key}`);
    
    return await s3.getObject(params).promise();
  } catch (error) {
    console.error('Error getting file from S3:', error);
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
