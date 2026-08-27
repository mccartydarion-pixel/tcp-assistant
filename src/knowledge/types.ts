export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface KnowledgeChunk {
  id: string;
  section: string;
  subsection?: string;
  heading: string;
  content: string;
  source: string;
  keywords: string[];
}

export interface RetrievalResult {
  chunk: KnowledgeChunk;
  score: number;
}

export interface AssistantRequest {
  userId: string;
  guildId: string;
  channelId: string;
  question: string;
  ticketId?: string;
}

export interface AssistantResponse {
  content: string;
  confidence: ConfidenceLevel;
  sources: string[];
  escalationRecommended: boolean;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  score: number;
  reason: string;
}

export interface TuningProfile {
  vertical?: number;
  horizontal?: number;
  adsSens?: number;
  precision?: number;
  response?: number;
  easing?: number;
  dayzVertical?: number;
  dayzHorizontal?: number;
  aimCurvature?: number;
  weapon?: string;
  optic?: string;
  distanceMeters?: number;
}

export type TuningObservation =
  | 'CLIMBING'
  | 'PULLING_DOWN'
  | 'DRIFTING_LEFT'
  | 'DRIFTING_RIGHT'
  | 'BOUNCING'
  | 'SLUGGISH'
  | 'TOO_FAST'
  | 'STABLE';

export interface TuningSession {
  userId: string;
  profile: TuningProfile;
  lastObservation?: TuningObservation;
  previousRecommendation?: string;
  updatedAt: number;
}

export type TicketCategory =
  | 'SETUP'
  | 'RECOIL'
  | 'ADS_ACCURACY'
  | 'AUTO_AIM'
  | 'AUTO_RUN'
  | 'FOLLOW_LEAN'
  | 'MENU'
  | 'INSTALLATION'
  | 'BUG_REPORT'
  | 'VERSION'
  | 'GENERAL'
  | 'UNKNOWN';

export type TicketStatus =
  | 'OPEN'
  | 'ASSISTING'
  | 'WAITING_USER'
  | 'OWNER_REVIEW'
  | 'RESOLVED'
  | 'CLOSED';

export interface BugReport {
  id: string;
  reporterId: string;
  version?: string;
  category: TicketCategory;
  description: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  reproductionSteps: string[];
  frequency?: 'ALWAYS' | 'SOMETIMES' | 'ONCE';
  settings?: TuningProfile;
  attachments: string[];
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
  createdAt: number;
}

export type IntentClassifier =
  | 'GENERAL_QA'
  | 'SETUP'
  | 'RECOIL'
  | 'ADS_ACCURACY'
  | 'AUTO_AIM'
  | 'AUTO_RUN'
  | 'FOLLOW_LEAN'
  | 'MENU'
  | 'TUNING'
  | 'BUG_REPORT'
  | 'RELEASE_INFO'
  | 'SERVER_NAVIGATION'
  | 'TICKET_SUPPORT'
  | 'UNKNOWN';
