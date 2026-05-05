/**
 * config.example.js — Vidyasetu Frontend Config
 *
 * HOW TO USE:
 *   1. Copy this file to config.js
 *   2. Fill in your real API keys in config.js
 *   3. config.js is git-ignored — your keys stay safe
 *
 * config.js is loaded via <script src="config.js"> in HTML pages.
 * It sets window.APP_CONFIG so all pages can access it.
 */
window.APP_CONFIG = {
  SUPABASE_URL:      'https://YOUR_PROJECT_REF.supabase.co',
  SUPABASE_ANON_KEY: 'your-supabase-anon-key-here',
  GEMINI_API_KEY:    'your-gemini-api-key-here',  // REMOVED — AI now uses NVIDIA (server-side only)
};
