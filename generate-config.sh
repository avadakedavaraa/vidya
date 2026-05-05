#!/bin/bash
# generate-config.sh — Called by Vercel at build time
# Reads environment variables and writes config.js
# No API keys are stored in the codebase.

echo "⚡ Generating config.js from environment variables..."

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ ERROR: Missing required environment variables!"
  echo "   Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY in Vercel dashboard."
  echo "   Optional: NVIDIA_API_KEY for AI question generation (server-side only)."
  exit 1
fi

cat > config.js << JSEOF
window.APP_CONFIG = {
  SUPABASE_URL:      '${SUPABASE_URL}',
  SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY}',
};
window.VS_CONFIG = {
  SUPABASE_URL:  window.APP_CONFIG.SUPABASE_URL,
  SUPABASE_ANON: window.APP_CONFIG.SUPABASE_ANON_KEY,
};
JSEOF

echo "✅ config.js generated successfully."
