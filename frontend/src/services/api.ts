import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
};

export const usersApi = {
  list: () => api.get('/users'),
  byRole: (role: string) => api.get(`/users/by-role/${role}`),
  companies: () => api.get('/users/companies'),
  team: () => api.get('/users/team'),
  userProjects: (id: number) => api.get(`/users/${id}/projects`),
  create: (data: any) => api.post('/users', data),
  update: (id: number, data: any) => api.put(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  changePassword: (current_password: string, new_password: string) =>
    api.put('/users/me/password', { current_password, new_password }),
  clientsByPod: () => api.get('/users/clients-by-pod'),
  myClients: () => api.get('/users/my-clients'),
  getNotifPrefs: (clientUserId: number | null) =>
    api.get('/users/notification-preferences', { params: clientUserId !== null ? { client_user_id: clientUserId } : {} }),
  saveNotifPrefs: (clientUserId: number | null, prefs: Record<string, boolean>) =>
    api.put('/users/notification-preferences', { client_user_id: clientUserId, prefs }),
};

export const categoriesApi = {
  list: () => api.get('/categories'),
  create: (name: string) => api.post('/categories', { name }),
  update: (id: number, name: string) => api.put(`/categories/${id}`, { name }),
  delete: (id: number) => api.delete(`/categories/${id}`),
};

export const projectsApi = {
  list: () => api.get('/projects'),
  get: (id: number) => api.get(`/projects/${id}`),
  create: (data: any) => api.post('/projects', data),
  update: (id: number, data: any) => api.put(`/projects/${id}`, data),
  delete: (id: number) => api.delete(`/projects/${id}`),
  managerResponse: (id: number, action: 'accept' | 'decline', member_ids?: number[]) =>
    api.post(`/projects/${id}/manager-response`, { action, member_ids }),
};

export const tasksApi = {
  list: (projectId?: number, pod?: string) => api.get('/tasks', { params: { ...(projectId ? { project_id: projectId } : {}), ...(pod ? { pod } : {}) } }),
  getApprovalFlow: (taskId: number) => api.get(`/tasks/${taskId}/approval-flow`),
  get: (id: number) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: number, data: any) => api.put(`/tasks/${id}`, data),
  updateChecklist: (taskId: number, itemId: number, completed: boolean) =>
    api.put(`/tasks/${taskId}/checklist/${itemId}`, { completed }),
  delete: (id: number) => api.delete(`/tasks/${id}`),
  accept: (id: number, action: 'accept' | 'decline') => api.post(`/tasks/${id}/accept`, { action }),
  timer: (id: number, action: 'start' | 'pause' | 'done') => api.post(`/tasks/${id}/timer`, { action }),
};

export const capacityApi = {
  daily: () => api.get('/capacity/daily'),
  check: (userId: number) => api.get(`/capacity/check/${userId}`),
  team: (pod?: 'pod1' | 'pod2', date?: string, overdue?: boolean) => api.get('/capacity/team', { params: { ...(pod ? { pod } : {}), ...(date ? { date } : {}), ...(overdue ? { overdue: 'true' } : {}) } }),
};

export const approvalsApi = {
  list: (pod?: string) => api.get('/approvals', { params: pod ? { pod } : {} }),
  submit: (data: any) => api.post('/approvals', data),
  review: (id: number, action: 'approve' | 'reject' | 'request_revision', notes?: string) =>
    api.put(`/approvals/${id}`, { action, notes }),
  markComplete: (id: number) => api.post(`/approvals/${id}/complete`),
  steps: (id: number) => api.get(`/approvals/${id}/steps`),
};

export const assetsApi = {
  list: (projectId?: number) => api.get('/assets', { params: projectId ? { project_id: projectId } : {} }),
  upload: (formData: FormData) => api.post('/assets', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  delete: (id: number) => api.delete(`/assets/${id}`),
  downloadUrl: (id: number) => `/api/assets/${id}/download`,
};

export const notificationsApi = {
  list: () => api.get('/notifications'),
  unreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id: number) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/mark-all-read'),
};

export const messagesApi = {
  list: (projectId?: number) => api.get('/messages', { params: projectId ? { project_id: projectId } : {} }),
  send: (message: string, projectId?: number) => api.post('/messages', { message, project_id: projectId }),
  uploadFile: (projectId: number, formData: FormData) =>
    api.post(`/messages/upload/${projectId}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

export const internalChatApi = {
  listChats: () => api.get('/internal-chat'),
  createChat: (data: { type: 'direct' | 'group'; name?: string; member_ids: number[] }) =>
    api.post('/internal-chat', data),
  getMessages: (chatId: number) => api.get(`/internal-chat/${chatId}/messages`),
  sendMessage: (chatId: number, content: string) => api.post(`/internal-chat/${chatId}/messages`, { content }),
  uploadFile: (chatId: number, formData: FormData) =>
    api.post(`/internal-chat/${chatId}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  addMember: (chatId: number, userId: number) => api.post(`/internal-chat/${chatId}/members`, { user_id: userId }),
};

export const mailApi = {
  list: () => api.get('/emails'),
  send: (data: { subject: string; body: string; recipient_ids: number[]; scheduled_at?: string }) =>
    api.post('/emails', data),
  delete: (id: number) => api.delete(`/emails/${id}`),
};

export const reportsApi = {
  summary: () => api.get('/reports/summary'),
  tasksByStatus: () => api.get('/reports/tasks-by-status'),
  projectsByClient: () => api.get('/reports/projects-by-client'),
};

export const adsApi = {
  getShareTokens: (clientId: number) => api.get(`/ads/share-tokens/${clientId}`),
  adApprovals: (clientId: number) => api.get(`/ads/ad-approvals/${clientId}`),
  createShare: (clientId: number, data: { startDate?: string; endDate?: string }) => api.post(`/ads/share/${clientId}`, data),
  revokeShareToken: (token: string) => api.delete(`/ads/share-token/${token}`),
};

export const seoApi = {
  clients: () => api.get('/seo/clients'),
  report: (clientId: number, range: string, startDate?: string, endDate?: string, country?: string, compareStart?: string, compareEnd?: string) =>
    api.get(`/seo/report/${clientId}`, { params: { range, startDate, endDate, country, compareStart, compareEnd } }),
  configClient: (clientId: number, data: { ga_property_id: string; gsc_site_url: string }) =>
    api.put(`/seo/clients/${clientId}`, data),
  getManual: (clientId: number) => api.get(`/seo/manual/${clientId}`),
  updateManual: (clientId: number, data: any) => api.put(`/seo/manual/${clientId}`, data),
  getShareTokens: (clientId: number) => api.get(`/seo/share-tokens/${clientId}`),
  createShare: (clientId: number, data: { range: string; startDate?: string; endDate?: string; compareStart?: string; compareEnd?: string; demographics?: string[]; acquisitions?: string[]; country?: string }) => api.post(`/seo/share/${clientId}`, data),
  revokeShareToken: (token: string) => api.delete(`/seo/share-token/${token}`),
  getSavedReports: (clientId: number) => api.get(`/seo/saved-reports/${clientId}`),
  saveReport: (clientId: number, data: { name: string; range: string; start_date?: string; end_date?: string; compare_start?: string; compare_end?: string; country?: string; manual_snapshot?: any }) => api.post(`/seo/saved-reports/${clientId}`, data),
  updateSavedReport: (reportId: number, data: { name: string; range: string; start_date?: string; end_date?: string; compare_start?: string; compare_end?: string; country?: string; manual_snapshot?: any }) => api.put(`/seo/saved-reports/${reportId}`, data),
  deleteSavedReport: (reportId: number) => api.delete(`/seo/saved-reports/${reportId}`),
  revokeAndRegenerateToken: (reportId: number) => api.patch(`/seo/saved-reports/${reportId}/revoke-token`),
};

export const contentApi = {
  generate: (data: { keywords: string[]; content_type: string; tone: string; extra_context?: string }) =>
    api.post('/content/generate', data),
};

export const contactFormsApi = {
  listProjects: () => api.get('/contact-forms'),
  getProject: (id: number) => api.get(`/contact-forms/${id}`),
  listForms: (projectId: number) => api.get(`/contact-forms/${projectId}/forms`),
  createForm: (projectId: number, name: string) => api.post(`/contact-forms/${projectId}/forms`, { name }),
  cloneForm: (projectId: number, formId: number) => api.post(`/contact-forms/${projectId}/forms/${formId}/clone`),
  getForm: (formId: number) => api.get(`/contact-forms/forms/${formId}`),
  updateForm: (formId: number, data: Record<string, any>) => api.patch(`/contact-forms/forms/${formId}`, data),
  deleteForm: (formId: number) => api.delete(`/contact-forms/forms/${formId}`),
  listSubmissions: (projectId: number, params?: { page?: number; per_page?: number; form_id?: number; unread_only?: boolean }) =>
    api.get(`/contact-forms/${projectId}/submissions`, { params }),
  getSubmission: (submissionId: number) => api.get(`/contact-forms/submissions/${submissionId}`),
  markRead: (submissionId: number, read = true) => api.patch(`/contact-forms/submissions/${submissionId}/read`, { read }),
  fileDownloadUrl: (submissionId: number, filename: string) => `/api/contact-forms/submissions/${submissionId}/files/${encodeURIComponent(filename)}`,
  uploadConfirmAttachment: (formId: number, file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post(`/contact-forms/forms/${formId}/confirmation-attachment`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  deleteConfirmAttachment: (formId: number) => api.delete(`/contact-forms/forms/${formId}/confirmation-attachment`),
};

export const timeLogsApi = {
  byProject: (projectId: number, params?: { from?: string; to?: string }) =>
    api.get(`/time-logs/project/${projectId}`, { params }),
  byUser: (userId: number, params?: { from?: string; to?: string }) =>
    api.get(`/time-logs/user/${userId}`, { params }),
  xlr8: (projectId: number) => api.get(`/time-logs/xlr8/${projectId}`),
  create: (data: { task_id: number; user_id: number; log_date: string; hours: number; notes?: string }) =>
    api.post('/time-logs', data),
  delete: (id: number) => api.delete(`/time-logs/${id}`),
};

export const appSettingsApi = {
  get: () => api.get('/app-settings'),
  save: (data: Record<string, string>) => api.put('/app-settings', data),
};

export const localSeoApi = {
  getConfig: (clientId: number) => api.get(`/local-seo/config/${clientId}`),
  saveConfig: (clientId: number, data: any) => api.put(`/local-seo/config/${clientId}`, data),
  geocode: (address: string) => api.post('/local-seo/geocode', { address }),
  runGeogrid: (clientId: number, data: { keyword: string; center_lat: number; center_lng: number; radius_km: number; grid_size: number; country_code: string; domain: string }) =>
    api.post(`/local-seo/geogrid/${clientId}`, data),
  getGeogrid: (clientId: number, keyword: string) => api.get(`/local-seo/geogrid/${clientId}`, { params: { keyword } }),
  getKeywords: (clientId: number) => api.get(`/local-seo/keywords/${clientId}`),
};

export const calendarApi = {
  getEvents: (month: string) => api.get('/calendar/events', { params: { month } }),
  listRecurring: () => api.get('/calendar/recurring'),
  createRecurring: (data: Record<string, any>) => api.post('/calendar/recurring', data),
  updateRecurring: (id: number, data: Record<string, any>) => api.put(`/calendar/recurring/${id}`, data),
  deleteRecurring: (id: number) => api.delete(`/calendar/recurring/${id}`),
};

export const xlr8Api = {
  // Ticket types (admin CRUD)
  getTicketTypes: () => api.get('/xlr8/ticket-types'),
  createTicketType: (data: any) => api.post('/xlr8/ticket-types', data),
  updateTicketType: (id: number, data: any) => api.put(`/xlr8/ticket-types/${id}`, data),
  deleteTicketType: (id: number) => api.delete(`/xlr8/ticket-types/${id}`),
  // Tickets
  getTickets: (project_id?: number) => api.get('/xlr8/tickets', { params: project_id ? { project_id } : {} }),
  createTicket: (data: any) => api.post('/xlr8/tickets', data),
  getTicket: (id: number) => api.get(`/xlr8/tickets/${id}`),
  getTicketLog: (id: number) => api.get(`/xlr8/tickets/${id}/log`),
  // Workflow actions
  acceptTicket: (id: number) => api.post(`/xlr8/tickets/${id}/accept`),
  assignTicket: (id: number, assignee_id: number) => api.post(`/xlr8/tickets/${id}/assign`, { assignee_id }),
  employeeAccept: (id: number) => api.post(`/xlr8/tickets/${id}/employee-accept`),
  employeeDecline: (id: number, comment?: string) => api.post(`/xlr8/tickets/${id}/employee-decline`, { comment }),
  markDone: (id: number) => api.post(`/xlr8/tickets/${id}/done`),
  reviewTicket: (id: number, action: 'approve' | 'decline', comment?: string, skip_admin?: boolean) =>
    api.post(`/xlr8/tickets/${id}/review`, { action, comment, skip_admin }),
  adminApprove: (id: number, comment?: string) => api.post(`/xlr8/tickets/${id}/admin-approve`, { comment }),
  adminSendClient: (id: number, comment?: string) => api.post(`/xlr8/tickets/${id}/admin-send-client`, { comment }),
  clientApprove: (id: number) => api.post(`/xlr8/tickets/${id}/client-approve`),
};

export default api;
