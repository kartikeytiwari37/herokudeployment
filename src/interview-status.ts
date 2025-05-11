/**
 * Enum for interview status values
 * This ensures we only use predefined status values throughout the application
 */
export enum InterviewStatus {
  // Initial state when creating the interview record
  PENDING = "pending",
  
  // Call states
  INITIATING = "initiating",
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  FAILED = "failed",
  
  // Interview outcome states
  COMPLETED = "completed",
  REJECTED = "rejected",
  SHORTLISTED = "shortlisted",
  
  // Error states
  ERROR = "error"
}

/**
 * Helper function to check if a status is valid
 * @param status The status to check
 * @returns True if the status is a valid InterviewStatus value
 */
export function isValidStatus(status: string): boolean {
  return Object.values(InterviewStatus).includes(status as InterviewStatus);
}

/**
 * Get a human-readable description of an interview status
 * @param status The status to describe
 * @returns A human-readable description of the status
 */
export function getStatusDescription(status: InterviewStatus): string {
  switch (status) {
    case InterviewStatus.PENDING:
      return "Interview is pending";
    case InterviewStatus.INITIATING:
      return "Call is being initiated";
    case InterviewStatus.CONNECTED:
      return "Call is connected";
    case InterviewStatus.DISCONNECTED:
      return "Call has been disconnected";
    case InterviewStatus.FAILED:
      return "Call failed to connect";
    case InterviewStatus.COMPLETED:
      return "Interview has been completed";
    case InterviewStatus.REJECTED:
      return "Candidate has been rejected";
    case InterviewStatus.SHORTLISTED:
      return "Candidate has been shortlisted";
    case InterviewStatus.ERROR:
      return "An error occurred during the interview";
    default:
      return "Unknown status";
  }
}
