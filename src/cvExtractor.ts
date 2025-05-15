import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { Readable } from 'stream';
// @ts-ignore
import pdfParse from 'pdf-parse';
// @ts-ignore
import * as mammoth from 'mammoth';
import { OpenAI } from 'openai';
// AWS SDK v3 imports
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Readable as ReadableStream } from 'stream';

// Load environment variables
dotenv.config();

// Configure AWS SDK v3
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

/**
 * Extract JSON from text that might contain markdown or explanatory text
 * @param text Text that might contain JSON
 * @returns Parsed JSON object
 */
function extractJsonFromText(text: string): any {
  try {
    // First try to parse the text directly as JSON
    try {
      return JSON.parse(text);
    } catch (e) {
      // Not valid JSON, continue with extraction
    }
    
    // Look for JSON between triple backticks with json tag
    const jsonCodeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/;
    const jsonCodeBlockMatch = text.match(jsonCodeBlockRegex);
    if (jsonCodeBlockMatch && jsonCodeBlockMatch[1]) {
      try {
        return JSON.parse(jsonCodeBlockMatch[1]);
      } catch (e) {
        console.log('Failed to parse JSON from code block');
      }
    }
    
    // Look for text between curly braces
    const jsonObjectRegex = /\{[\s\S]*\}/;
    const jsonObjectMatch = text.match(jsonObjectRegex);
    if (jsonObjectMatch) {
      try {
        return JSON.parse(jsonObjectMatch[0]);
      } catch (e) {
        console.log('Failed to parse JSON from curly braces');
      }
    }
    
    // If all else fails, create a basic structure with any extracted information
    console.log('Could not extract valid JSON, creating basic structure');
    return {
      personalInfo: {
        name: extractNameFromText(text),
        email: extractEmailFromText(text),
        phone: extractPhoneFromText(text),
        location: '',
        summary: ''
      },
      workExperience: [],
      skills: {
        technical: [],
        soft: [],
        domain: []
      },
      achievements: []
    };
  } catch (error) {
    console.error('Error extracting JSON from text:', error);
    throw new Error('Failed to extract JSON from AI response');
  }
}

/**
 * Extract name from text
 */
function extractNameFromText(text: string): string {
  // Look for "name:" or "Name:" followed by text
  const nameRegex = /(?:name|Name):\s*([^\n,]+)/;
  const nameMatch = text.match(nameRegex);
  if (nameMatch && nameMatch[1]) {
    return nameMatch[1].trim();
  }
  return '';
}

/**
 * Extract email from text
 */
function extractEmailFromText(text: string): string {
  // Look for email pattern
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
  const emailMatch = text.match(emailRegex);
  if (emailMatch) {
    return emailMatch[0];
  }
  return '';
}

/**
 * Extract phone from text
 */
function extractPhoneFromText(text: string): string {
  // Look for phone pattern
  const phoneRegex = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) {
    return phoneMatch[0];
  }
  return '';
}

// Configure OpenAI based on provider
const AI_PROVIDER = process.env.AI_PROVIDER || 'openai';
let openaiClient: OpenAI | null = null;

/**
 * Download a file from S3
 * @param fileName The name of the file to download
 * @returns Buffer containing the file content
 */
export async function downloadFileFromS3(fileName: string): Promise<Buffer | null> {
  try {
    console.log(`Attempting to download file from S3: ${fileName}`);
    
    const params = {
      Bucket: process.env.AWS_S3_BUCKET || '',
      Key: fileName
    };
    
    const command = new GetObjectCommand(params);
    const response = await s3Client.send(command);
    
    if (!response.Body) {
      console.error(`File ${fileName} has no content`);
      return null;
    }
    
    // Convert the readable stream to a buffer
    const streamBody = response.Body as ReadableStream;
    const chunks: Buffer[] = [];
    
    for await (const chunk of streamBody) {
      chunks.push(Buffer.from(chunk));
    }
    
    const fileBuffer = Buffer.concat(chunks);
    console.log(`Successfully downloaded file: ${fileName} (${fileBuffer.length} bytes)`);
    return fileBuffer;
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
    const params = {
      Bucket: process.env.AWS_S3_BUCKET || '',
      Key: fileName
    };
    
    const command = new HeadObjectCommand(params);
    await s3Client.send(command);
    console.log(`File ${fileName} exists in S3`);
    return true;
  } catch (error) {
    console.log(`File ${fileName} does not exist in S3 or cannot be accessed`);
    return false;
  }
}

/**
 * Extract text from a PDF file
 * @param fileBuffer Buffer containing the PDF file content
 * @returns Extracted text
 */
async function extractTextFromPdf(fileBuffer: Buffer): Promise<string> {
  try {
    console.log(`Extracting text from PDF (${fileBuffer.length} bytes)`);
    
    // Try with pdf-parse first
    try {
      const data = await pdfParse(fileBuffer, {
        // Add options to improve extraction
        pagerender: function(pageData: any) {
          // Return text from the page
          return pageData.getTextContent()
            .then(function(textContent: any) {
              let lastY, text = '';
              for (let item of textContent.items) {
                if (lastY == item.transform[5] || !lastY)
                  text += item.str;
                else
                  text += '\n' + item.str;
                lastY = item.transform[5];
              }
              return text;
            });
        }
      });
      
      if (data.text && data.text.length > 100) {
        console.log(`Successfully extracted ${data.text.length} characters from PDF with pdf-parse`);
        return data.text;
      } else {
        console.log(`PDF extraction with pdf-parse returned only ${data.text.length} characters, trying fallback method`);
        // If we got very little text, try the fallback method
        throw new Error('Insufficient text extracted');
      }
    } catch (pdfParseError) {
      console.error('Error with pdf-parse extraction, trying fallback method:', pdfParseError);
      
      // Fallback: Try to extract text directly from the PDF buffer
      // This is a simple approach that might work for some PDFs
      const text = fileBuffer.toString('utf-8');
      
      // Look for text patterns in the raw buffer
      const textMatches = text.match(/\(([A-Za-z0-9\s.,;:'"!?@#$%^&*()-_+=<>{}[\]|\\\/]+)\)/g);
      if (textMatches && textMatches.length > 0) {
        // Clean up the extracted text
        const extractedText = textMatches
          .map(match => match.substring(1, match.length - 1))
          .filter(text => text.length > 1)  // Filter out single characters
          .join(' ');
        
        console.log(`Extracted ${extractedText.length} characters using fallback method`);
        
        if (extractedText.length > 100) {
          return extractedText;
        }
      }
      
      // If we still don't have enough text, try another approach
      // Extract any text-like content from the buffer
      const allTextMatches = text.match(/[A-Za-z0-9\s.,;:'"!?@#$%^&*()-_+=<>{}[\]|\\\/]{5,}/g);
      if (allTextMatches && allTextMatches.length > 0) {
        const extractedText = allTextMatches.join(' ');
        console.log(`Extracted ${extractedText.length} characters using second fallback method`);
        return extractedText;
      }
      
      // If all else fails, return what we have from pdf-parse
      console.log('All extraction methods failed, returning minimal text');
      return text.substring(0, 10000);  // Limit to 10K chars
    }
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    // Return an empty string rather than throwing, so we can still try to extract info
    return '';
  }
}

/**
 * Extract text from a DOCX file
 * @param fileBuffer Buffer containing the DOCX file content
 * @returns Extracted text
 */
async function extractTextFromDocx(fileBuffer: Buffer): Promise<string> {
  try {
    console.log(`Extracting text from DOCX (${fileBuffer.length} bytes)`);
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    console.log(`Successfully extracted ${result.value.length} characters from DOCX`);
    return result.value;
  } catch (error) {
    console.error('Error extracting text from DOCX:', error);
    throw new Error('Failed to extract text from DOCX');
  }
}

// Initialize OpenAI client if using OpenAI
if (AI_PROVIDER === 'openai') {
  openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  console.log('OpenAI API configured');
}

/**
 * Extract information from CV text using AI
 * @param text CV text content
 * @returns Extracted information object
 */
async function extractInfoWithAI(text: string): Promise<any> {
  console.log(`Using AI provider: ${AI_PROVIDER}`);
  
  // Prepare the prompt for AI
  const prompt = `
    Extract the following information from this CV/resume:
    1. Personal Information (name, email, phone, location, etc.)
    2. Work Experience (for each position: title, company, duration, responsibilities)
    3. Skills (technical skills, soft skills, domain-specific skills)
    4. Achievements (awards, recognitions, notable accomplishments)
    
    Format your response as a valid JSON object with this structure:
    {
      "personalInfo": {
        "name": "",
        "email": "",
        "phone": "",
        "location": "",
        "linkedIn": "",
        "summary": ""
      },
      "workExperience": [
        {
          "company": "",
          "position": "",
          "duration": "",
          "responsibilities": ["", ""],
          "achievements": ["", ""]
        }
      ],
      "skills": {
        "technical": ["", ""],
        "soft": ["", ""],
        "domain": ["", ""]
      },
      "achievements": [
        {
          "title": "",
          "description": ""
        }
      ]
    }
    
    CV text:
    ${text.substring(0, 15000)}  // Limit text to 15K chars to avoid token limits
  `;
  
  if (AI_PROVIDER === 'openai' && openaiClient) {
    try {
      console.log('Extracting CV info using OpenAI');
      const response = await openaiClient.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are a CV parsing expert that extracts structured information from resumes." },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });
      
      const jsonResponse = response.choices[0]?.message?.content;
      if (!jsonResponse) {
        throw new Error("No response from OpenAI API");
      }
      
      console.log('Received response from OpenAI');
      return JSON.parse(jsonResponse);
    } catch (error) {
      console.error('Error using OpenAI for extraction:', error);
      throw error;
    }
  } else if (AI_PROVIDER === 'azure') {
    try {
      console.log('Extracting CV info using Azure OpenAI');
      
      // Get API key and endpoint from environment variables
      const apiKey = process.env.AZURE_OPENAI_ANALYSIS_API_KEY || '';
      const endpoint = process.env.AZURE_OPENAI_ANALYSIS_ENDPOINT || '';
      const deploymentId = process.env.AZURE_OPENAI_ANALYSIS_DEPLOYMENT_ID || '';
      const apiVersion = process.env.AZURE_OPENAI_ANALYSIS_API_VERSION || '2024-02-15-preview';
      
      if (!apiKey || !endpoint || !deploymentId) {
        throw new Error('Azure OpenAI configuration is incomplete. Check your environment variables.');
      }
      
      // Format the Azure OpenAI API URL
      const azureEndpoint = `${endpoint}/openai/deployments/${deploymentId}/chat/completions?api-version=${apiVersion}`;
      
      console.log(`Using Azure OpenAI endpoint: ${endpoint}/openai/deployments/${deploymentId}/chat/completions`);
      
      // Call Azure OpenAI API
      const response = await fetch(azureEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a CV parsing expert that extracts structured information from resumes." },
            { role: "user", content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      });
      
      // Parse response
      const data = await response.json();
      
      if (!response.ok) {
        console.error("Azure OpenAI API error:", data);
        throw new Error(`Azure OpenAI API error: ${data.error?.message || "Unknown error"}`);
      }
      
      const responseText = data.choices?.[0]?.message?.content;
      if (!responseText) {
        throw new Error("No response from Azure OpenAI API");
      }
      
      console.log('Received response from Azure OpenAI');
      
      // Extract JSON from the response text
      // The model might return the JSON with markdown formatting or explanatory text
      return extractJsonFromText(responseText);
    } catch (error) {
      console.error('Error using Azure OpenAI for extraction:', error);
      throw error;
    }
  } else {
    console.error('No AI provider configured correctly');
    throw new Error('AI extraction is not available - check your configuration');
  }
}

/**
 * Extract information from a CV using AI
 * @param fileBuffer Buffer containing the CV file content
 * @param mimeType MIME type of the file
 * @returns Extracted information object
 */
export async function extractCVInfo(fileBuffer: Buffer, mimeType: string): Promise<any> {
  try {
    console.log(`Extracting information from CV (${fileBuffer.length} bytes, ${mimeType})`);
    
    // Extract text from the file based on its type
    let text = '';
    
    if (mimeType === 'application/pdf') {
      text = await extractTextFromPdf(fileBuffer);
    } else if (mimeType.includes('word')) {
      text = await extractTextFromDocx(fileBuffer);
    } else {
      // For other file types, assume it's plain text
      text = fileBuffer.toString('utf-8');
    }
    
    console.log(`Extracted ${text.length} characters of text from CV`);
    
    // Use AI to extract structured information
    const extractedInfo = await extractInfoWithAI(text);
    
    console.log('Successfully extracted CV information using AI');
    return extractedInfo;
  } catch (error) {
    console.error('Error extracting CV information:', error);
    
    // Fallback to rule-based extraction if AI extraction fails
    try {
      console.log('Falling back to rule-based extraction');
      let text = '';
      
      if (mimeType === 'application/pdf') {
        try {
          text = await extractTextFromPdf(fileBuffer);
        } catch (pdfError) {
          console.error('Error in PDF fallback extraction:', pdfError);
          text = fileBuffer.toString('utf-8').substring(0, 10000); // Take first 10K chars as fallback
        }
      } else if (mimeType.includes('word')) {
        try {
          text = await extractTextFromDocx(fileBuffer);
        } catch (docxError) {
          console.error('Error in DOCX fallback extraction:', docxError);
          text = fileBuffer.toString('utf-8').substring(0, 10000); // Take first 10K chars as fallback
        }
      } else {
        text = fileBuffer.toString('utf-8');
      }
      
      const extractedInfo = {
        personalInfo: extractPersonalInfo(text),
        workExperience: extractWorkExperience(text),
        skills: extractSkills(text),
        achievements: extractAchievements(text)
      };
      
      console.log('Successfully extracted CV information using rule-based approach');
      return extractedInfo;
    } catch (fallbackError) {
      console.error('Error in fallback extraction:', fallbackError);
      return {
        error: 'Failed to extract CV information',
        details: error instanceof Error ? error.message : 'Unknown error',
        fallbackError: fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error'
      };
    }
  }
}

/**
 * Extract personal information from CV text using regex patterns
 */
function extractPersonalInfo(text: string): any {
  console.log('Extracting personal information using regex patterns');
  
  // Initialize with empty values
  const personalInfo: any = {
    name: '',
    email: '',
    phone: '',
    location: '',
    linkedIn: '',
    summary: ''
  };
  
  // Extract email
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = text.match(emailRegex);
  if (emails && emails.length > 0) {
    personalInfo.email = emails[0];
  }
  
  // Extract phone number (various formats)
  const phoneRegex = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const phones = text.match(phoneRegex);
  if (phones && phones.length > 0) {
    personalInfo.phone = phones[0];
  }
  
  // Extract LinkedIn URL
  const linkedInRegex = /(?:linkedin\.com\/in\/|linkedin\.com\/profile\/view\?id=|linkedin\.com\/pub\/)[A-Za-z0-9_-]+/gi;
  const linkedIns = text.match(linkedInRegex);
  if (linkedIns && linkedIns.length > 0) {
    personalInfo.linkedIn = linkedIns[0];
  }
  
  // Try to extract name (this is more complex and error-prone)
  // Look for name at the beginning of the document
  const lines = text.split('\n');
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();
    // If line is short and doesn't contain common words like "resume" or "cv"
    if (line.length > 0 && line.length < 40 && 
        !line.toLowerCase().includes('resume') && 
        !line.toLowerCase().includes('cv') &&
        !line.toLowerCase().includes('@') &&
        !line.match(/^\d+/)) {
      personalInfo.name = line;
      break;
    }
  }
  
  // Try to extract location
  const locationRegex = /(?:^|\s)([A-Za-z\s]+,\s*[A-Za-z\s]+(?:\s+\d{5,6})?)/g;
  const locations = text.match(locationRegex);
  if (locations && locations.length > 0) {
    personalInfo.location = locations[0].trim();
  }
  
  // Try to extract summary
  // Look for a paragraph after "summary", "profile", or "objective"
  const summaryRegex = /(?:summary|profile|objective|about me)[:]*\s*([\s\S]{10,500}?)(?:\n\n|\n\s*\n)/i;
  const summaryMatch = text.match(summaryRegex);
  if (summaryMatch && summaryMatch[1]) {
    personalInfo.summary = summaryMatch[1].trim();
  }
  
  return personalInfo;
}

/**
 * Extract work experience from CV text using regex patterns
 */
function extractWorkExperience(text: string): any[] {
  console.log('Extracting work experience using regex patterns');
  
  const experiences: any[] = [];
  
  // Try to find experience section
  const experienceSectionRegex = /(?:experience|employment|work history|professional experience|career history)(?:\s*:)?\s*\n([\s\S]*?)(?:\n\s*(?:education|skills|projects|achievements|certifications|languages|references|additional information))/i;
  const experienceMatch = text.match(experienceSectionRegex);
  
  if (experienceMatch && experienceMatch[1]) {
    const experienceSection = experienceMatch[1];
    
    // Split into job blocks
    const jobBlocks = experienceSection.split(/\n\n+/);
    
    jobBlocks.forEach(block => {
      if (block.trim().length < 10) return; // Skip very short blocks
      
      const lines = block.trim().split('\n');
      if (lines.length < 2) return; // Need at least company and position
      
      const company = lines[0].trim();
      const position = lines[1].trim();
      
      // Try to extract duration
      let duration = '';
      const durationRegex = /(?:\d{4}\s*-\s*(?:\d{4}|present|current)|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[.\s\w-]+)/i;
      
      for (const line of lines) {
        const durationMatch = line.match(durationRegex);
        if (durationMatch) {
          duration = durationMatch[0];
          break;
        }
      }
      
      // Extract responsibilities and achievements
      const responsibilities: string[] = [];
      const achievements: string[] = [];
      
      let inResponsibilities = true; // Default to responsibilities
      
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Check if this line starts a achievements section
        if (line.toLowerCase().includes('achievement') || 
            line.toLowerCase().includes('accomplishment') ||
            line.toLowerCase().includes('award')) {
          inResponsibilities = false;
          continue;
        }
        
        // Add to appropriate array
        if (line.startsWith('•') || line.startsWith('-') || line.match(/^\d+\./)) {
          const cleanLine = line.replace(/^[•\-\d.]+\s*/, '');
          if (inResponsibilities) {
            responsibilities.push(cleanLine);
          } else {
            achievements.push(cleanLine);
          }
        } else if (line.length > 15) {
          // If it's a substantial line, add it
          if (inResponsibilities) {
            responsibilities.push(line);
          } else {
            achievements.push(line);
          }
        }
      }
      
      experiences.push({
        company,
        position,
        duration,
        responsibilities,
        achievements
      });
    });
  }
  
  // If no experiences found, try a different approach
  if (experiences.length === 0) {
    // Look for job titles followed by company names
    const jobTitleRegex = /(?:^|\n)((?:Senior|Junior|Lead|Chief|Principal|Associate)?\s*(?:Developer|Engineer|Manager|Director|Analyst|Consultant|Specialist|Coordinator|Administrator|Assistant|Officer|Executive|President|CEO|CTO|CFO|COO|VP|Head|Chief|Supervisor|Team Lead|Architect|Designer|Programmer|Technician|Support|Sales|Marketing|HR|Finance|Accounting|Legal|Operations|Product|Project|Program|Business|Data|Software|Hardware|Network|System|Web|Mobile|Cloud|DevOps|QA|Test|Security|UI|UX|Frontend|Backend|Full Stack|Full-Stack|Fullstack).*?)(?:\n|\s+at\s+|\s*-\s*|\s*@\s*)([\w\s&]+)(?:\n|\s+)((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)[\s\d,-]+(?:to|-)[\s\d,-]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December|Present|Current|Now))/gi;
    
    let match;
    while ((match = jobTitleRegex.exec(text)) !== null) {
      experiences.push({
        position: match[1].trim(),
        company: match[2].trim(),
        duration: match[3].trim(),
        responsibilities: [],
        achievements: []
      });
    }
  }
  
  return experiences;
}

/**
 * Extract skills from CV text using regex patterns
 */
function extractSkills(text: string): any {
  console.log('Extracting skills using regex patterns');
  
  const skills = {
    technical: [] as string[],
    soft: [] as string[],
    domain: [] as string[]
  };
  
  // Common technical skills
  const technicalSkillsRegex = /\b(JavaScript|TypeScript|Python|Java|C\+\+|C#|Ruby|PHP|Swift|Kotlin|Go|Rust|SQL|MongoDB|PostgreSQL|MySQL|Redis|Oracle|AWS|Azure|GCP|Docker|Kubernetes|Jenkins|Git|HTML|CSS|React|Angular|Vue|Node\.js|Express|Django|Flask|Spring|Laravel|TensorFlow|PyTorch|Pandas|NumPy|Excel|PowerPoint|Word|Outlook|Photoshop|Illustrator|Figma|Sketch|Adobe|SAP|Salesforce|Tableau|Power BI|JIRA|Confluence|Trello|Asana|Monday|Slack|Teams|Zoom)\b/gi;
  
  // Common soft skills
  const softSkillsRegex = /\b(Communication|Leadership|Teamwork|Problem.Solving|Critical.Thinking|Decision.Making|Time.Management|Adaptability|Flexibility|Creativity|Innovation|Emotional.Intelligence|Interpersonal|Negotiation|Conflict.Resolution|Presentation|Public.Speaking|Writing|Listening|Customer.Service|Client.Relations|Mentoring|Coaching|Training|Collaboration|Cooperation|Coordination|Organization|Planning|Prioritization|Delegation|Supervision|Management|Strategy|Analysis|Research|Detail.Oriented|Multitasking|Stress.Management|Work.Ethic|Professionalism|Integrity|Ethics|Honesty|Reliability|Responsibility|Accountability|Initiative|Proactive|Self.Motivated|Self.Directed|Independent|Autonomous|Resourceful|Persistent|Resilient|Patient|Empathetic|Compassionate|Diplomatic|Tactful|Persuasive|Influential)\b/gi;
  
  // Common domain skills for sales/business
  const domainSkillsRegex = /\b(Sales|Marketing|Business.Development|Account.Management|Customer.Success|Client.Relationship|Lead.Generation|Prospecting|Cold.Calling|Closing|Negotiation|Upselling|Cross.Selling|B2B|B2C|SaaS|Enterprise|SMB|Retail|E.Commerce|Digital.Marketing|Content.Marketing|SEO|SEM|Social.Media|Email.Marketing|Campaign.Management|Brand.Management|Product.Marketing|Market.Research|Competitive.Analysis|CRM|Salesforce|HubSpot|Pipedrive|Forecasting|Budgeting|P&L|Revenue.Growth|Profit.Margin|ROI|KPI|Metrics|Analytics|Reporting|Presentations|Proposals|RFPs|Contracts|Partnerships|Alliances|Channel.Sales|Direct.Sales|Inside.Sales|Outside.Sales|Field.Sales|Territory.Management|Pipeline.Management|Quota|Target|Goal|Commission|Incentive|Bonus|Compensation|Pricing|Discount|Promotion|Campaign|Launch|Go.To.Market|Strategy|Tactics|Planning|Execution|Implementation|Adoption|Retention|Churn|Renewal|Expansion|Growth|Scale|Market.Share|Competitive.Advantage|Value.Proposition|Unique.Selling.Proposition|Elevator.Pitch|Messaging|Positioning|Segmentation|Targeting|Persona|Buyer.Journey|Customer.Experience|User.Experience|Feedback|Survey|NPS|CSAT|Customer.Satisfaction|Customer.Loyalty|Customer.Advocacy|Referral|Testimonial|Case.Study|Success.Story|ROI.Analysis|TCO|Total.Cost.of.Ownership|Value.Analysis|Business.Case|Use.Case|Solution.Selling|Consultative.Selling|Relationship.Selling|Challenger.Sale|SPIN.Selling|Sandler.Selling|Miller.Heiman|Solution.Design|Needs.Assessment|Discovery|Qualification|BANT|MEDDIC|GPCT|Objection.Handling|Closing.Techniques|Follow.Up|Networking|Trade.Show|Conference|Event|Webinar|Workshop|Seminar|Presentation|Demo|Proof.of.Concept|Trial|Pilot|Implementation|Onboarding|Training|Support|Customer.Success|Account.Management|Relationship.Management|Stakeholder.Management|Executive.Relationship|C.Suite|Decision.Maker|Influencer|Champion|Sponsor|Gatekeeper|Blocker|Competitor|Differentiation|Positioning|Messaging|Value.Proposition|Elevator.Pitch|Storytelling|Business.Acumen|Industry.Knowledge|Market.Knowledge|Product.Knowledge|Technical.Knowledge|Financial.Acumen|Business.Case|ROI.Analysis|TCO.Analysis|Value.Analysis|Pricing.Strategy|Discount.Strategy|Negotiation.Strategy|Closing.Strategy|Account.Strategy|Territory.Strategy|Market.Strategy|Competitive.Strategy|Growth.Strategy|Retention.Strategy|Expansion.Strategy|Upsell.Strategy|Cross.Sell.Strategy|Renewal.Strategy|Customer.Success.Strategy|Customer.Experience.Strategy|Digital.Strategy|Social.Selling|LinkedIn.Sales.Navigator)\b/gi;
  
  // Extract skills
  const technicalMatches = text.match(technicalSkillsRegex);
  const softMatches = text.match(softSkillsRegex);
  const domainMatches = text.match(domainSkillsRegex);
  
  // Add unique skills to the appropriate category
  if (technicalMatches) {
    const uniqueTechnical = [...new Set(technicalMatches.map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()))];
    skills.technical = uniqueTechnical;
  }
  
  if (softMatches) {
    const uniqueSoft = [...new Set(softMatches.map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()))];
    skills.soft = uniqueSoft;
  }
  
  if (domainMatches) {
    const uniqueDomain = [...new Set(domainMatches.map(s => s.replace(/\./g, ' ').charAt(0).toUpperCase() + s.replace(/\./g, ' ').slice(1).toLowerCase()))];
    skills.domain = uniqueDomain;
  }
  
  return skills;
}

/**
 * Extract achievements from CV text using regex patterns
 */
function extractAchievements(text: string): any[] {
  console.log('Extracting achievements using regex patterns');
  
  const achievements: any[] = [];
  
  // Try to find achievements section
  const achievementSectionRegex = /(?:achievements|accomplishments|awards|honors|recognitions)(?:\s*:)?\s*\n([\s\S]*?)(?:\n\s*(?:education|skills|projects|experience|certifications|languages|references|additional information))/i;
  const achievementMatch = text.match(achievementSectionRegex);
  
  if (achievementMatch && achievementMatch[1]) {
    const achievementSection = achievementMatch[1];
    
    // Split into achievement items
    const achievementItems = achievementSection.split(/\n\s*[•\-\*]\s*|\n\s*\d+\.\s*/);
    
    achievementItems.forEach(item => {
      const trimmedItem = item.trim();
      if (trimmedItem.length > 10) {
        // Try to extract year
        const yearMatch = trimmedItem.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? yearMatch[0] : '';
        
        // Try to extract title and description
        let title = '';
        let description = trimmedItem;
        
        // If there's a colon, use it to split title and description
        if (trimmedItem.includes(':')) {
          const parts = trimmedItem.split(':');
          title = parts[0].trim();
          description = parts.slice(1).join(':').trim();
        } else if (trimmedItem.includes(' - ')) {
          // If there's a dash, use it to split title and description
          const parts = trimmedItem.split(' - ');
          title = parts[0].trim();
          description = parts.slice(1).join(' - ').trim();
        } else {
          // Otherwise, use the first few words as the title
          const words = trimmedItem.split(' ');
          if (words.length > 3) {
            title = words.slice(0, 3).join(' ');
            description = trimmedItem;
          } else {
            title = trimmedItem;
            description = '';
          }
        }
        
        achievements.push({
          title,
          year,
          description
        });
      }
    });
  }
  
  // If no achievements found, try to extract from work experience
  if (achievements.length === 0) {
    // Look for achievement indicators in the text
    const achievementIndicators = [
      /increased\s+(?:sales|revenue|profit|growth)/i,
      /improved\s+(?:efficiency|productivity|performance)/i,
      /reduced\s+(?:costs|expenses|time|errors)/i,
      /awarded|recognized|honored|won|achieved/i,
      /top\s+(?:performer|sales|producer|achiever)/i
    ];
    
    const lines = text.split('\n');
    
    for (const line of lines) {
      for (const indicator of achievementIndicators) {
        if (indicator.test(line) && line.length > 20) {
          achievements.push({
            title: line.substring(0, 30) + '...',
            year: '',
            description: line
          });
          break;
        }
      }
    }
  }
  
  return achievements;
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
