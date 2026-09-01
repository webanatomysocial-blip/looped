export type Role = 'admin' | 'manager' | 'employee' | 'client';

export type ApprovalStatus =
  | 'pending_manager'
  | 'pending_admin'
  | 'pending_client'
  | 'pending_admin_final'
  | 'pending_manager_final'
  | 'pending_custom'
  | 'approved'
  | 'rejected'
  | 'work_in_progress'
  | 'pending_review'
  | 'revision_requested'
  | (string & {});

export type WorkflowType = 'employee' | 'manager' | 'admin_with_client' | 'admin_no_client' | 'custom' | 'xlr8' | null;

export interface FlowStep {
  position: number;
  user_id: number;
  name: string;
  role: string;
  avatar_color: string;
}

export interface ApprovalStep {
  id: number;
  approval_id: number;
  stage_key: string;
  required_role: string;
  action: 'approve' | 'reject';
  actor_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  comments: string | null;
  acted_at: string;
}

export interface EmployeeCategory {
  id: number;
  name: string;
  created_at?: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  avatar_color: string;
  pod?: 'pod1' | 'pod2' | null;
  categories?: EmployeeCategory[];
  monthly_salary?: number | null;
  client_company_id?: number | null;
}

export interface ClientCompany {
  id: number;
  name: string;
  pod?: string | null;
}

export interface Project {
  id: number;
  name: string;
  client_company_id: number | null;
  client_name: string | null;
  status: 'active' | 'in_review' | 'on_hold' | 'completed';
  due_date: string | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
  members: ProjectMember[];
  // Billing fields
  service_type: 'per_project' | 'xlr8';
  budget_amount: number | null;
  budget_cutoff_pct: number | null;
  budgeted_hours: number | null;
  monthly_hours_bucket: number | null;
  billing_cycle_start_day: number | null;
  // Computed aggregates
  hours_logged: number;
  hours_this_cycle: number | null;
  budget_pct: number;
  // Per-project cost analytics
  working_budget: number | null;
  total_spend: number | null;
  amount_remaining: number | null;
  budget_used_pct: number | null;
  health_flag: 'green' | 'amber' | 'red' | null;
  // Project flow fields
  pod: 'pod1' | 'pod2' | null;
  start_date: string | null;
  briefing_doc: string | null;
  project_drive_doc: string | null;
  manager_status: 'pending_manager' | 'accepted' | 'declined' | null;
}

export interface TimeLog {
  id: number;
  task_id: number;
  task_title: string;
  project_id: number;
  project_name: string;
  user_id: number;
  user_name: string;
  user_color: string;
  log_date: string;
  hours: number;
  notes: string | null;
  created_at: string;
}

export interface ProjectMember {
  user_id: number;
  name: string;
  avatar_color: string;
  role: Role;
}

export interface TaskAssignee {
  user_id: number;
  name: string;
  avatar_color: string;
  role?: Role;
  assignee_role?: 'employee' | 'manager';
  acceptance_status?: 'pending' | 'accepted' | 'declined';
  stage_idx?: number;
  est_hours?: number | null;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  project_id: number;
  project_name: string;
  client_name: string | null;
  assigned_to: number | null;
  assigned_name: string | null;
  assigned_color: string | null;
  assignees: TaskAssignee[];
  created_by: number;
  created_by_name: string;
  due_date: string | null;
  due_time: string | null;
  status: 'todo' | 'in_progress' | 'in_review' | 'overdue' | 'completed';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  checklist_total: number;
  checklist_done: number;
  has_rejected_approval?: boolean;
  estimated_hours: number | null;
  my_acceptance_status: 'pending' | 'accepted' | 'declined' | null;
  timer_running: boolean;
  active_runner_ids: number[];
  created_at: string;
  checklist?: ChecklistItem[];
  // XLR8 ticket fields
  ticket_type_id?: number | null;
  xlr8_status?: string | null;
  xlr8_assignee_id?: number | null;
  xlr8_assignee_name?: string | null;
  xlr8_stage_idx?: number | null;
}

export interface CapacityTask {
  id: number;
  title: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
  estimated_hours: number | null;
  stage_est_hours?: number | null;
  project_name: string;
  acceptance_status: 'pending' | 'accepted' | 'declined';
  assignee_role: 'employee' | 'manager' | 'review' | null;
  tracked_seconds_today: number;
  timer_running: boolean;
  has_rejected_approval?: boolean;
  ticket_type_id?: number | null;
}

export interface CapacityData {
  tracked_seconds: number;
  capacity_seconds: number;
  active_task_id: number | null;
  active_session_start: string | null;
  tasks: CapacityTask[];
}

export interface TeamMemberCapacity {
  user_id: number;
  name: string;
  avatar_color: string;
  role: Role;
  pod?: 'pod1' | 'pod2' | null;
  tracked_seconds: number;
  capacity_seconds: number;
  active_task_id: number | null;
  active_task_title: string | null;
  tasks: CapacityTask[];
}

export interface ChecklistItem {
  id: number;
  task_id: number;
  text: string;
  completed: boolean;
}

export interface Approval {
  id: number;
  task_id: number;
  task_title: string;
  title: string;
  project_id: number;
  project_name: string;
  client_name: string | null;
  submitted_by: number;
  submitted_by_name: string;
  submitted_by_color: string;
  worker_name: string | null;
  worker_avatar_color: string | null;
  status: ApprovalStatus;
  workflow_type: WorkflowType;
  current_step: number | null;
  flow_chain: FlowStep[] | null;
  // Manager review
  manager_approved_by: number | null;
  manager_approved_at: string | null;
  manager_notes: string | null;
  // Admin review
  admin_approved_by: number | null;
  admin_approved_at: string | null;
  admin_notes: string | null;
  // Completion review
  work_submitted_at: string | null;
  revision_notes: string | null;
  final_approved_by: number | null;
  final_approved_at: string | null;
  timer_running: boolean;
  tracked_seconds_today: number;
  final_notes: string | null;
  // Rejection
  rejected_by: number | null;
  rejected_at: string | null;
  rejection_notes: string | null;
  created_at: string;
  // XLR8 ticket fields (populated when workflow_type === 'xlr8')
  xlr8_stages?: { category_name: string }[] | null;
  xlr8_stage_idx?: number | null;
  xlr8_status?: string | null;
  xlr8_final_approval?: { adminRequired?: boolean; clientOptional?: boolean } | null;
  xlr8_ticket_type_name?: string | null;
}

export interface Asset {
  id: number;
  name: string;
  file_type: string | null;
  file_path: string | null;
  file_size: number | null;
  project_id: number | null;
  project_name: string | null;
  uploaded_by: number;
  uploaded_by_name: string;
  avatar_color: string;
  created_at: string;
}

export interface Notification {
  id: number;
  user_id: number;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
  project_id: number | null;
  project_name: string | null;
}

export interface Message {
  id: number;
  sender_id: number;
  sender_name: string;
  sender_color: string;
  sender_role: Role;
  project_id: number | null;
  project_name: string | null;
  message: string;
  created_at: string;
}

export interface InternalChat {
  id: number;
  type: 'direct' | 'group';
  name: string | null;
  created_by: number;
  created_at: string;
  members: { id: number; name: string; avatar_color: string; role: Role }[];
  last_message: InternalMessage | null;
}

export interface InternalMessage {
  id: number;
  chat_id: number;
  sender_id: number;
  sender_name: string;
  sender_color: string;
  sender_role: Role;
  content: string;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
}

export interface ReportSummary {
  total_projects: number;
  active_projects: number;
  total_tasks: number;
  completed_tasks: number;
  pending_approvals: number;
  total_users: number;
}
