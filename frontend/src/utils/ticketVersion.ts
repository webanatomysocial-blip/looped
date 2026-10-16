// Ticket version: created = v1.0.0.0, each work rejection (manager/reviewer or admin send-back) adds 1
// to the last number. An employee declining to take a stage is not a rejection of the work.
export const REJECTION_ACTIONS = ['manager_declined', 'admin_declined'];

export const isRejection = (action?: string) => !!action && REJECTION_ACTIONS.includes(action);

export const fmtVersion = (rejections: number) => `v1.0.0.${rejections}`;

export const ticketVersion = (log: { action?: string }[] = []) =>
  fmtVersion(log.filter((e) => isRejection(e.action)).length);
