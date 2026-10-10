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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
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
    const full_name = String(body.full_name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const confirm_password = String(body.confirm_password || '')
    const role = String(body.role || '')
    const status = body.status === 'inactive' ? 'inactive' : 'active'

    if (!full_name) return json({ error: 'Full Name is required.' }, 400)
    if (!email) return json({ error: 'Email is required.' }, 400)
    if (!isValidEmail(email)) return json({ error: 'Enter a valid email address.' }, 400)
    if (!password || password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400)
    if (password !== confirm_password) return json({ error: 'Passwords do not match.' }, 400)
    if (!ROLES.includes(role)) return json({ error: 'Invalid role.' }, 400)

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })

    if (createErr) return json({ error: createErr.message }, 400)

    const userId = created.user?.id
    if (!userId) return json({ error: 'User was not created.' }, 500)

    const { error: profileErr } = await adminClient.from('profiles').upsert({
      id: userId,
      email,
      full_name,
      role,
      status,
      active: status === 'active',
      updated_at: new Date().toISOString(),
    })

    if (profileErr) {
      await adminClient.auth.admin.deleteUser(userId)
      return json({ error: profileErr.message }, 400)
    }

    return json({
      user: { id: userId, email, full_name, role, status },
    })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Server error.' }, 500)
  }
})
