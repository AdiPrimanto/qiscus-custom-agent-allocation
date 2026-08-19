export interface CandidateAgent {
  id: number;
  name: string;
  email: string;
  is_available: boolean;
  type: number;
  type_as_string: string;
  assigned_rules: string[];
}

export interface CustomAgentAllocationWebhookPayload {
  app_id: string;
  source: string;
  name: string;
  email: string;
  avatar_url: string;
  extras: string | null;
  is_resolved: boolean;
  room_id: string;
  candidate_agent: CandidateAgent;
}

export interface AvailableAgent {
  id: number;
  name: string;
  email: string;
  type: number;
  type_as_string: string;
  is_available: boolean;
  is_verified: boolean;
  current_customer_count: number;
  assigned_rules: string[];
}

export interface AssignAgentResponse {
  data: {
    added_agent: {
      id: number;
      name: string;
      email: string;
      is_available: boolean;
    };
  };
}

export interface MarkAsResolvedWebhookPayload {
  service: {
    id: number;
    room_id: string;
    is_resolved: boolean;
    notes: string | null;
    first_comment_id: string;
    last_comment_id: number;
    source: string;
  };
  resolved_by: {
    id: number;
    email: string;
    name: string;
    type: string;
    is_available: boolean;
  };
  customer: {
    user_id: string;
  };
}
