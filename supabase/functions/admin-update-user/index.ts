import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ROLES = ['Admin', 'Staff', 'Warehouse']

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401)

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Unauthorized.' }, 401)

    const adminClient = createClient(supabaseUrl, serviceKey)
    const { data: callerProfile } = await adminClient
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .maybeSingle()

    if (callerProfile?.role !== 'Admin' || callerProfile?.status === 'inactive') {
      return json({ error: 'Admin access required.' }, 403)
    }

    const body = await req.json()
    const userId = String(body.userId || '')
    const full_name = String(body.full_name || '').trim()
    const role = String(body.role || '')
    const status = body.status === 'inactive' ? 'inactive' : 'active'
    const password = String(body.password || '')

    if (!userId) return json({ error: 'Missing user id.' }, 400)
    if (!full_name) return json({ error: 'Full Name is required.' }, 400)
    if (!ROLES.includes(role)) return json({ error: 'Invalid role.' }, 400)

    if (String(userId) === String(user.id) && status === 'inactive') {
      return json({ error: 'You cannot deactivate your own account.' }, 400)
    }

    if (password && password.length < 8) {
      return json({ error: 'Password must be at least 8 characters.' }, 400)
    }

    if (password) {
      const { error: pwErr } = await adminClient.auth.admin.updateUserById(userId, { password })
      if (pwErr) return json({ error: pwErr.message }, 400)
    }

    const { error: profileErr } = await adminClient.from('profiles').update({
      full_name,
      role,
      status,
      active: status === 'active',
      updated_at: new Date().toISOString(),
    }).eq('id', userId)

    if (profileErr) return json({ error: profileErr.message }, 400)

    const { data: updated } = await adminClient
      .from('profiles')
      .select('id, email, role, full_name, status, last_login, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle()

    return json({ user: updated })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Server error.' }, 500)
  }
})
