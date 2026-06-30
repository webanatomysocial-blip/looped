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
};

export const tasksApi = {
  list: (projectId?: number) => api.get('/tasks', { params: projectId ? { project_id: projectId } : {} }),
  get: (id: number) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: number, data: any) => api.put(`/tasks/${id}`, data),
  updateChecklist: (taskId: number, itemId: number, completed: boolean) =>
    api.put(`/tasks/${taskId}/checklist/${itemId}`, { completed }),
  delete: (id: number) => api.delete(`/tasks/${id}`),
};

export const approvalsApi = {
  list: () => api.get('/approvals'),
  submit: (data: any) => api.post('/approvals', data),
  review: (id: number, action: 'approve' | 'reject' | 'request_revision', notes?: string) =>
    api.put(`/approvals/${id}`, { action, notes }),
  markComplete: (id: number) => api.post(`/approvals/${id}/complete`),
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

export const seoApi = {
  clients: () => api.get('/seo/clients'),
  report: (clientId: number, range: string, startDate?: string, endDate?: string) =>
    api.get(`/seo/report/${clientId}`, { params: { range, startDate, endDate } }),
  configClient: (clientId: number, data: { ga_property_id: string; gsc_site_url: string }) =>
    api.put(`/seo/clients/${clientId}`, data),
  getManual: (clientId: number) => api.get(`/seo/manual/${clientId}`),
  updateManual: (clientId: number, data: any) => api.put(`/seo/manual/${clientId}`, data),
};

export const contentApi = {
  generate: (data: { keywords: string[]; content_type: string; tone: string; extra_context?: string }) =>
    api.post('/content/generate', data),
};

export default api;
