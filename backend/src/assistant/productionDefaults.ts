// The WhatsApp assistant's settings for the live server, compiled into the code so they are always present, however
// the server is deployed. Applied only when NODE_ENV=production, and only for settings the server has not set itself.
// No secrets here: the AI key is saved from the dashboard (Configuration) or set in the server's .env.
export const PRODUCTION_DEFAULTS: Readonly<Record<string, string>> = {
  ASSISTANT_ENABLED: 'true',
  ASSISTANT_AI_PROVIDER: 'openai',
  ASSISTANT_OPENAI_MODEL: 'gpt-5.4-nano',
  ASSISTANT_TIMEZONE: 'Asia/Kolkata',
  ASSISTANT_EXECUTION_ENABLED: 'false',
  ASSISTANT_WHATSAPP_ENABLED: 'true',
  // In the home folder of the user that runs the server, outside the deploy folder, so redeploys keep the pairing
  ASSISTANT_WHATSAPP_SESSION_DIR: '~/loop-whatsapp-session',
  // The Loop Testing group
  WHATSAPP_NOTIFICATION_GROUP_JID: '120363412745413406@g.us',
};

export function applyProductionDefaults(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return false;
  for (const [k, v] of Object.entries(PRODUCTION_DEFAULTS)) if (!env[k]?.trim()) env[k] = v;
  return true;
}
