export type Role = 'admin' | 'manager' | 'employee' | 'client';

export type ApprovalStatus =
  | 'pending_manager'
  | 'pending_admin'
  | 'pending_client'
  | 'work_in_progress'
  | 'pending_review'
  | 'revision_requested'
  | 'approved'
  | 'rejected';

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
  categories?: EmployeeCategory[];
}

export interface ClientCompany {
  id: number;
  name: string;
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
  status: 'todo' | 'in_progress' | 'in_review' | 'overdue' | 'completed';
  checklist_total: number;
  checklist_done: number;
  created_at: string;
  checklist?: ChecklistItem[];
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
  status: ApprovalStatus;
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
  final_notes: string | null;
  // Rejection
  rejected_by: number | null;
  rejected_at: string | null;
  rejection_notes: string | null;
  created_at: string;
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
