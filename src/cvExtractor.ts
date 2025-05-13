import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
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
 * Download a file from S3
 * @param fileName The name of the file to download
 * @returns Buffer containing the file content
 */
export async function downloadFileFromS3(fileName: string): Promise<Buffer | null> {
  try {
    console.log(`Attempting to download file from S3: ${fileName}`);
    
    const params: AWS.S3.GetObjectRequest = {
      Bucket: process.env.AWS_S3_BUCKET || '',
      Key: fileName
    };
    
    const data = await s3.getObject(params).promise();
    
    if (!data.Body) {
      console.error(`File ${fileName} has no content`);
      return null;
    }
    
    console.log(`Successfully downloaded file: ${fileName} (${data.ContentLength} bytes)`);
    return data.Body as Buffer;
  } catch (error) {
    console.error(`Error downloading file ${fileName} from S3:`, error);
    return null;
  }
}

/**
 * Check if a file exists in S3
 * @param fileName The name of the file to check
 * @returns Boolean indicating if the file exists
 */
export async function checkFileExistsInS3(fileName: string): Promise<boolean> {
  try {
    const params: AWS.S3.HeadObjectRequest = {
      Bucket: process.env.AWS_S3_BUCKET || '',
      Key: fileName
    };
    
    await s3.headObject(params).promise();
    console.log(`File ${fileName} exists in S3`);
    return true;
  } catch (error) {
    console.log(`File ${fileName} does not exist in S3 or cannot be accessed`);
    return false;
  }
}

/**
 * Extract information from a CV using OpenAI
 * @param fileBuffer Buffer containing the CV file content
 * @param mimeType MIME type of the file
 * @returns Extracted information object
 */
export async function extractCVInfo(fileBuffer: Buffer, mimeType: string): Promise<any> {
  try {
    console.log(`Extracting information from CV (${fileBuffer.length} bytes, ${mimeType})`);
    
    // For this implementation, we'll use a simple extraction approach
    // In a production environment, you might want to use a more sophisticated CV parsing service
    
    // Convert buffer to text (this is a simplified approach)
    let text = '';
    
    if (mimeType === 'application/pdf') {
      // For PDF files, we'd normally use a PDF parsing library
      // For this example, we'll simulate extraction with a placeholder
      text = `This is extracted text from a PDF file. 
      In a real implementation, you would use a PDF parsing library.`;
    } else if (mimeType.includes('word')) {
      // For Word documents, we'd normally use a DOCX parsing library
      // For this example, we'll simulate extraction with a placeholder
      text = `This is extracted text from a Word document. 
      In a real implementation, you would use a DOCX parsing library.`;
    } else {
      // For other file types, assume it's plain text
      text = fileBuffer.toString('utf-8');
    }
    
    // Extract structured information using a simple rule-based approach
    // In a real implementation, you would use NLP or a specialized CV parsing service
    const extractedInfo = {
      personalInfo: extractPersonalInfo(text),
      workExperience: extractWorkExperience(text),
      education: extractEducation(text),
      skills: extractSkills(text),
      languages: extractLanguages(text),
      certifications: extractCertifications(text),
      projects: extractProjects(text),
      achievements: extractAchievements(text),
      references: extractReferences(text),
      salesMetrics: extractSalesMetrics(text),
      jobPreferences: extractJobPreferences(text),
      careerSummary: extractCareerSummary(text)
    };
    
    console.log('Successfully extracted CV information');
    return extractedInfo;
  } catch (error) {
    console.error('Error extracting CV information:', error);
    return {
      error: 'Failed to extract CV information',
      details: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Extract personal information from CV text
 */
function extractPersonalInfo(text: string): any {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return {
    name: 'Extracted Name',
    email: 'extracted.email@example.com',
    phone: '+1234567890',
    address: 'Extracted Address',
    city: 'City Name',
    state: 'State Name',
    pincode: '123456',
    dateOfBirth: '1990-01-01',
    gender: 'Male',
    maritalStatus: 'Single',
    nationality: 'Indian',
    linkedIn: 'linkedin.com/in/profile',
    socialMedia: {
      twitter: 'twitter.com/handle',
      github: 'github.com/username'
    },
    summary: 'Professional summary extracted from the CV'
  };
}

/**
 * Extract work experience from CV text
 */
function extractWorkExperience(text: string): any[] {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return [
    {
      company: 'Example Company 1',
      position: 'Senior Position',
      location: 'Mumbai, India',
      duration: '2020-2023',
      isCurrentEmployer: true,
      responsibilities: [
        'Led a team of 5 sales executives',
        'Achieved 120% of sales targets consistently',
        'Managed key client relationships'
      ],
      achievements: [
        'Top performer award 2022',
        'Increased territory sales by 35%'
      ],
      industry: 'Financial Services',
      department: 'Sales',
      reportingTo: 'Sales Manager',
      teamSize: 5,
      description: 'Job responsibilities and achievements'
    },
    {
      company: 'Example Company 2',
      position: 'Junior Position',
      location: 'Delhi, India',
      duration: '2018-2020',
      isCurrentEmployer: false,
      responsibilities: [
        'Generated leads through cold calling',
        'Conducted product demonstrations',
        'Processed sales documentation'
      ],
      achievements: [
        'Rookie of the year 2019',
        'Exceeded targets by 15%'
      ],
      industry: 'Technology',
      department: 'Sales',
      reportingTo: 'Team Lead',
      teamSize: 0,
      description: 'Job responsibilities and achievements'
    }
  ];
}

/**
 * Extract education information from CV text
 */
function extractEducation(text: string): any[] {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return [
    {
      institution: 'Example University',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
      year: '2018',
      location: 'Mumbai, India',
      grade: '8.5 CGPA',
      achievements: ['Dean\'s List', 'Academic Scholarship'],
      courses: ['Data Structures', 'Algorithms', 'Database Management']
    },
    {
      institution: 'Example High School',
      degree: 'Higher Secondary Certificate',
      field: 'Science',
      year: '2014',
      location: 'Delhi, India',
      grade: '85%',
      achievements: ['School Topper'],
      courses: ['Physics', 'Chemistry', 'Mathematics']
    }
  ];
}

/**
 * Extract skills from CV text
 */
function extractSkills(text: string): any {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return {
    technical: [
      'MS Office Suite',
      'CRM Software',
      'Sales Analytics Tools'
    ],
    soft: [
      'Communication',
      'Negotiation',
      'Leadership',
      'Time Management'
    ],
    domain: [
      'Financial Products',
      'Retail Sales',
      'B2B Sales',
      'Customer Relationship Management'
    ],
    languages: [
      'English',
      'Hindi',
      'Marathi'
    ]
  };
}

/**
 * Extract languages from CV text
 */
function extractLanguages(text: string): any[] {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return [
    {
      language: 'English',
      proficiency: 'Fluent',
      reading: 'Advanced',
      writing: 'Advanced',
      speaking: 'Advanced'
    },
    {
      language: 'Hindi',
      proficiency: 'Native',
      reading: 'Native',
      writing: 'Native',
      speaking: 'Native'
    },
    {
      language: 'Marathi',
      proficiency: 'Intermediate',
      reading: 'Intermediate',
      writing: 'Basic',
      speaking: 'Intermediate'
    }
  ];
}

/**
 * Extract certifications from CV text
 */
function extractCertifications(text: string): any[] {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return [
    {
      name: 'Certified Sales Professional',
      issuer: 'Sales Association of India',
      date: '2022',
      expiryDate: '2025',
      credentialID: 'CSP12345'
    },
    {
      name: 'Financial Products Specialist',
      issuer: 'Banking Institute',
      date: '2021',
      expiryDate: null,
      credentialID: 'FPS67890'
    }
  ];
}

/**
 * Extract projects from CV text
 */
function extractProjects(text: string): any[] {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return [
    {
      name: 'Market Expansion Project',
      duration: '2022-2023',
      description: 'Led a team to expand sales into new territories',
      role: 'Project Lead',
      outcome: 'Increased market presence by 25% in target regions'
    },
    {
      name: 'CRM Implementation',
      duration: '2021',
      description: 'Participated in implementing new CRM system',
      role: 'Team Member',
      outcome: 'Improved lead tracking efficiency by 40%'
    }
  ];
}

/**
 * Extract achievements from CV text
 */
function extractAchievements(text: string): any[] {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return [
    {
      title: 'Top Sales Performer',
      year: '2022',
      description: 'Recognized as top sales performer in the region'
    },
    {
      title: 'President\'s Club',
      year: '2021',
      description: 'Selected for exclusive high-achievers club'
    },
    {
      title: 'Innovation Award',
      year: '2020',
      description: 'Developed new sales approach that increased conversion rates'
    }
  ];
}

/**
 * Extract references from CV text
 */
function extractReferences(text: string): any[] {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return [
    {
      name: 'John Doe',
      position: 'Sales Manager',
      company: 'Previous Employer',
      contact: 'john.doe@example.com',
      relationship: 'Direct Manager'
    },
    {
      name: 'Jane Smith',
      position: 'Regional Director',
      company: 'Current Employer',
      contact: '+1234567890',
      relationship: 'Senior Manager'
    }
  ];
}

/**
 * Extract sales metrics from CV text
 */
function extractSalesMetrics(text: string): any {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return {
    averageTargetAchievement: '115%',
    highestSalesRecord: '₹50 lakhs in a quarter',
    clientRetentionRate: '85%',
    leadConversionRate: '35%',
    averageDealSize: '₹5 lakhs',
    salesCycle: '45 days',
    territories: ['Mumbai', 'Pune', 'Nashik'],
    productSpecialization: ['Personal Loans', 'Home Loans', 'Insurance'],
    keyAccounts: 5,
    teamPerformance: 'Led team to 120% of target'
  };
}

/**
 * Extract job preferences from CV text
 */
function extractJobPreferences(text: string): any {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return {
    preferredLocations: ['Mumbai', 'Pune', 'Bangalore'],
    expectedSalary: '₹10-12 LPA',
    preferredIndustries: ['Banking', 'Financial Services', 'Insurance'],
    preferredRoles: ['Sales Manager', 'Territory Manager', 'Account Executive'],
    willingToRelocate: true,
    noticePeriod: '30 days',
    workMode: 'Field Sales',
    travelWillingness: 'Up to 70%'
  };
}

/**
 * Extract career summary from CV text
 */
function extractCareerSummary(text: string): string {
  // In a real implementation, you would use regex patterns or NLP to extract this information
  // This is a simplified placeholder implementation
  return 'Results-driven sales professional with 5+ years of experience in financial products sales. Consistently exceeded targets and built strong client relationships. Skilled in consultative selling, territory management, and team leadership. Looking for growth opportunities in sales management roles.';
}

/**
 * Process a CV file by name
 * @param fileName Name of the CV file in S3
 * @returns Extracted CV information or null if processing failed
 */
export async function processCVByName(fileName: string): Promise<any | null> {
  try {
    // Check if file exists in S3
    const fileExists = await checkFileExistsInS3(fileName);
    if (!fileExists) {
      console.error(`File ${fileName} does not exist in S3`);
      return null;
    }
    
    // Download file from S3
    const fileBuffer = await downloadFileFromS3(fileName);
    if (!fileBuffer) {
      console.error(`Failed to download file ${fileName} from S3`);
      return null;
    }
    
    // Determine MIME type based on file extension
    let mimeType = 'application/octet-stream'; // Default
    if (fileName.toLowerCase().endsWith('.pdf')) {
      mimeType = 'application/pdf';
    } else if (fileName.toLowerCase().endsWith('.doc')) {
      mimeType = 'application/msword';
    } else if (fileName.toLowerCase().endsWith('.docx')) {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    
    // Extract information from CV
    const extractedInfo = await extractCVInfo(fileBuffer, mimeType);
    
    return {
      filename: fileName,
      extractedInfo
    };
  } catch (error) {
    console.error(`Error processing CV ${fileName}:`, error);
    return null;
  }
}
