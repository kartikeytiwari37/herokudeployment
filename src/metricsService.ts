import { Session } from './types';

/**
 * Interface for conversation metrics
 */
export interface ConversationMetrics {
  // Call identification
  callSid: string;
  
  // Connection metrics
  callStartTime?: number;
  openAIConnectionStartTime?: number;
  openAIConnectionEndTime?: number;
  openAIConnectionLatency?: number;
  
  // User speech metrics
  userSpeechEvents: UserSpeechEvent[];
  
  // AI response metrics
  aiResponseEvents: AIResponseEvent[];
  
  // Overall metrics
  totalUserSpeechTime?: number;
  totalAIResponseTime?: number;
  totalSilenceTime?: number;
  totalConversationTime?: number;
  
  // Turn metrics
  totalTurns?: number;
  averageUserSpeechDuration?: number;
  averageAIResponseDuration?: number;
  averageAIResponseLatency?: number;
  
  // Analysis metrics
  analysisStartTime?: number;
  analysisEndTime?: number;
  analysisLatency?: number;
}

/**
 * Interface for user speech event
 */
export interface UserSpeechEvent {
  itemId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  transcriptLength?: number;
}

/**
 * Interface for AI response event
 */
export interface AIResponseEvent {
  itemId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  latency?: number; // Time between user speech end and AI response start
  contentLength?: number;
}

// Map to store metrics by call SID
const metricsMap = new Map<string, ConversationMetrics>();

/**
 * Initialize metrics for a call
 * @param callSid Call SID
 * @returns Initialized metrics object
 */
export function initializeMetrics(callSid: string): ConversationMetrics {
  const metrics: ConversationMetrics = {
    callSid,
    callStartTime: Date.now(),
    userSpeechEvents: [],
    aiResponseEvents: []
  };
  
  metricsMap.set(callSid, metrics);
  console.log(`[METRICS] Initialized metrics for call ${callSid}`);
  return metrics;
}

/**
 * Get metrics for a call
 * @param callSid Call SID
 * @returns Metrics object or undefined if not found
 */
export function getMetrics(callSid: string): ConversationMetrics | undefined {
  return metricsMap.get(callSid);
}

/**
 * Record OpenAI connection start
 * @param callSid Call SID
 */
export function recordOpenAIConnectionStart(callSid: string): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics) return;
  
  metrics.openAIConnectionStartTime = Date.now();
  console.log(`[METRICS] OpenAI connection started for call ${callSid}`);
}

/**
 * Record OpenAI connection end
 * @param callSid Call SID
 */
export function recordOpenAIConnectionEnd(callSid: string): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics || !metrics.openAIConnectionStartTime) return;
  
  metrics.openAIConnectionEndTime = Date.now();
  metrics.openAIConnectionLatency = metrics.openAIConnectionEndTime - metrics.openAIConnectionStartTime;
  
  console.log(`[METRICS] OpenAI connection established for call ${callSid} in ${metrics.openAIConnectionLatency}ms`);
}

/**
 * Record user speech start
 * @param callSid Call SID
 * @param itemId Item ID
 */
export function recordUserSpeechStart(callSid: string, itemId: string): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics) return;
  
  const event: UserSpeechEvent = {
    itemId,
    startTime: Date.now()
  };
  
  metrics.userSpeechEvents.push(event);
  console.log(`[METRICS] User speech started for call ${callSid}, item ${itemId}`);
}

/**
 * Record user speech end
 * @param callSid Call SID
 * @param itemId Item ID
 * @param transcriptLength Length of the transcript
 */
export function recordUserSpeechEnd(callSid: string, itemId: string, transcriptLength: number): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics) return;
  
  const event = metrics.userSpeechEvents.find(e => e.itemId === itemId);
  if (!event) return;
  
  event.endTime = Date.now();
  event.duration = event.endTime - event.startTime;
  event.transcriptLength = transcriptLength;
  
  console.log(`[METRICS] User speech ended for call ${callSid}, item ${itemId}, duration ${event.duration}ms, transcript length ${transcriptLength} chars`);
}

/**
 * Record AI response start
 * @param callSid Call SID
 * @param itemId Item ID
 */
export function recordAIResponseStart(callSid: string, itemId: string): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics) return;
  
  // Calculate latency from the last user speech event
  let latency: number | undefined;
  if (metrics.userSpeechEvents.length > 0) {
    const lastUserSpeech = metrics.userSpeechEvents[metrics.userSpeechEvents.length - 1];
    if (lastUserSpeech.endTime) {
      latency = Date.now() - lastUserSpeech.endTime;
    }
  }
  
  const event: AIResponseEvent = {
    itemId,
    startTime: Date.now(),
    latency
  };
  
  metrics.aiResponseEvents.push(event);
  console.log(`[METRICS] AI response started for call ${callSid}, item ${itemId}${latency ? `, latency ${latency}ms` : ''}`);
}

/**
 * Record AI response end
 * @param callSid Call SID
 * @param itemId Item ID
 * @param contentLength Length of the response content
 */
export function recordAIResponseEnd(callSid: string, itemId: string, contentLength: number): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics) return;
  
  const event = metrics.aiResponseEvents.find(e => e.itemId === itemId);
  if (!event) return;
  
  event.endTime = Date.now();
  event.duration = event.endTime - event.startTime;
  event.contentLength = contentLength;
  
  console.log(`[METRICS] AI response ended for call ${callSid}, item ${itemId}, duration ${event.duration}ms, content length ${contentLength} chars`);
}

/**
 * Record analysis start
 * @param callSid Call SID
 */
export function recordAnalysisStart(callSid: string): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics) return;
  
  metrics.analysisStartTime = Date.now();
  console.log(`[METRICS] Analysis started for call ${callSid}`);
}

/**
 * Record analysis end
 * @param callSid Call SID
 */
export function recordAnalysisEnd(callSid: string): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics || !metrics.analysisStartTime) return;
  
  metrics.analysisEndTime = Date.now();
  metrics.analysisLatency = metrics.analysisEndTime - metrics.analysisStartTime;
  
  console.log(`[METRICS] Analysis completed for call ${callSid} in ${metrics.analysisLatency}ms`);
}

/**
 * Calculate and update overall metrics for a call
 * @param callSid Call SID
 */
export function calculateOverallMetrics(callSid: string): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics || !metrics.callStartTime) return;
  
  // Calculate total conversation time
  metrics.totalConversationTime = Date.now() - metrics.callStartTime;
  
  // Calculate total user speech time
  metrics.totalUserSpeechTime = metrics.userSpeechEvents.reduce((total, event) => {
    return total + (event.duration || 0);
  }, 0);
  
  // Calculate total AI response time
  metrics.totalAIResponseTime = metrics.aiResponseEvents.reduce((total, event) => {
    return total + (event.duration || 0);
  }, 0);
  
  // Calculate total turns
  metrics.totalTurns = Math.min(metrics.userSpeechEvents.length, metrics.aiResponseEvents.length);
  
  // Calculate average durations
  if (metrics.userSpeechEvents.length > 0) {
    const validUserEvents = metrics.userSpeechEvents.filter(e => e.duration !== undefined);
    if (validUserEvents.length > 0) {
      metrics.averageUserSpeechDuration = validUserEvents.reduce((total, event) => {
        return total + (event.duration || 0);
      }, 0) / validUserEvents.length;
    }
  }
  
  if (metrics.aiResponseEvents.length > 0) {
    const validAIEvents = metrics.aiResponseEvents.filter(e => e.duration !== undefined);
    if (validAIEvents.length > 0) {
      metrics.averageAIResponseDuration = validAIEvents.reduce((total, event) => {
        return total + (event.duration || 0);
      }, 0) / validAIEvents.length;
    }
    
    const validLatencyEvents = metrics.aiResponseEvents.filter(e => e.latency !== undefined);
    if (validLatencyEvents.length > 0) {
      metrics.averageAIResponseLatency = validLatencyEvents.reduce((total, event) => {
        return total + (event.latency || 0);
      }, 0) / validLatencyEvents.length;
    }
  }
  
  // Calculate total silence time (approximation)
  const totalTrackedTime = (metrics.totalUserSpeechTime || 0) + (metrics.totalAIResponseTime || 0);
  metrics.totalSilenceTime = (metrics.totalConversationTime || 0) - totalTrackedTime;
  if (metrics.totalSilenceTime < 0) metrics.totalSilenceTime = 0; // Ensure non-negative
  
  console.log(`[METRICS] Overall metrics calculated for call ${callSid}`);
  logMetricsSummary(callSid);
}

/**
 * Log metrics summary for a call
 * @param callSid Call SID
 */
export function logMetricsSummary(callSid: string): void {
  const metrics = metricsMap.get(callSid);
  if (!metrics) return;
  
  console.log(`
=== CALL METRICS SUMMARY FOR ${callSid} ===
Total conversation time: ${formatDuration(metrics.totalConversationTime)}
Total user speech time: ${formatDuration(metrics.totalUserSpeechTime)} (${calculatePercentage(metrics.totalUserSpeechTime, metrics.totalConversationTime)}%)
Total AI response time: ${formatDuration(metrics.totalAIResponseTime)} (${calculatePercentage(metrics.totalAIResponseTime, metrics.totalConversationTime)}%)
Total silence time: ${formatDuration(metrics.totalSilenceTime)} (${calculatePercentage(metrics.totalSilenceTime, metrics.totalConversationTime)}%)

Total turns: ${metrics.totalTurns || 0}
Average user speech duration: ${formatDuration(metrics.averageUserSpeechDuration)}
Average AI response duration: ${formatDuration(metrics.averageAIResponseDuration)}
Average AI response latency: ${formatDuration(metrics.averageAIResponseLatency)}

OpenAI connection latency: ${formatDuration(metrics.openAIConnectionLatency)}
Analysis latency: ${formatDuration(metrics.analysisLatency)}

User speech events: ${metrics.userSpeechEvents.length}
AI response events: ${metrics.aiResponseEvents.length}
=== END OF METRICS SUMMARY ===
  `);
}

/**
 * Format duration in milliseconds to a human-readable string
 * @param duration Duration in milliseconds
 * @returns Formatted duration string
 */
function formatDuration(duration?: number): string {
  if (duration === undefined) return 'N/A';
  
  if (duration < 1000) {
    return `${duration}ms`;
  } else if (duration < 60000) {
    return `${(duration / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(duration / 60000);
    const seconds = ((duration % 60000) / 1000).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Calculate percentage
 * @param part Part value
 * @param total Total value
 * @returns Formatted percentage string
 */
function calculatePercentage(part?: number, total?: number): string {
  if (part === undefined || total === undefined || total === 0) return 'N/A';
  return (part / total * 100).toFixed(2);
}

/**
 * Get metrics for all calls
 * @returns Map of call SIDs to metrics
 */
export function getAllMetrics(): Map<string, ConversationMetrics> {
  return metricsMap;
}

/**
 * Clear metrics for a call
 * @param callSid Call SID
 */
export function clearMetrics(callSid: string): void {
  metricsMap.delete(callSid);
  console.log(`[METRICS] Cleared metrics for call ${callSid}`);
}
