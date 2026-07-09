import { createClient, SupabaseClient } from '@supabase/supabase-js';

export async function checkAdminGrantedPro(uid: string, env: Env): Promise<boolean> {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SERVICE_KEY || '';
  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from('users')
    .select('admin_granted_pro')
    .eq('id', uid)
    .single();

  if (error) {
    console.error('Error checking admin-granted Pro status:', error);
    return false;
  }

  return data.admin_granted_pro || false;
}
