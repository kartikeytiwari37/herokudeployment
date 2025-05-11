import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

// S3 configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET || 'hr-cv-storage-dev';

/**
 * Upload a file to S3
 * @param fileBuffer - The file buffer to upload
 * @param fileName - The original file name
 * @param contentType - The content type of the file
 * @returns Object containing the S3 key and URL
 */
export async function uploadFileToS3(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<{ key: string; url: string }> {
  try {
    // Use the original filename for the S3 key exactly as is
    const key = `cvs/${fileName}`;

    console.log(`[S3] Uploading file: ${fileName} to ${BUCKET_NAME}/${key}`);

    // Upload the file to S3
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    };

    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);

    // Generate a pre-signed URL for accessing the file
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

    console.log(`[S3] Successfully uploaded file to ${BUCKET_NAME}/${key}`);
    return { key, url };
  } catch (error) {
    console.error('[S3] Error uploading file to S3:', error);
    throw new Error(`Failed to upload file to S3: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get a file from S3
 * @param key - The S3 key of the file
 * @returns The file buffer
 */
export async function getFileFromS3(key: string): Promise<Buffer> {
  try {
    console.log(`[S3] Getting file from ${BUCKET_NAME}/${key}`);

    const getParams = {
      Bucket: BUCKET_NAME,
      Key: key,
    };

    const command = new GetObjectCommand(getParams);
    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    // Convert the readable stream to a buffer
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  } catch (error) {
    console.error('[S3] Error getting file from S3:', error);
    throw new Error(`Failed to get file from S3: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a pre-signed URL for accessing a file in S3
 * @param key - The S3 key of the file
 * @param expiresIn - The number of seconds until the URL expires (default: 3600)
 * @returns The pre-signed URL
 */
export async function getSignedFileUrl(key: string, expiresIn = 3600): Promise<string> {
  try {
    console.log(`[S3] Generating signed URL for ${BUCKET_NAME}/${key}`);

    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, getCommand, { expiresIn });
    return url;
  } catch (error) {
    console.error('[S3] Error generating signed URL:', error);
    throw new Error(`Failed to generate signed URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
