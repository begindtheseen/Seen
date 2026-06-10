import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://tmngmmofrplsldvlobfx.supabase.co'
// Security enforced by RLS — never put service_role key here
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtbmdtbW9mcnBsc2xkdmxvYmZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3OTk3ODYsImV4cCI6MjA5MzM3NTc4Nn0.kAL3GbMilYTM3z7Ct4YM2nTh3n-f1UXXqiDHOl3fsRc'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
