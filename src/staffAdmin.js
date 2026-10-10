import { supabase } from './supabaseClient.js'

export const ALL_STAFF_ROLES = ['Admin', 'Staff', 'Warehouse']
export const PROFILE_ADMIN_FIELDS = 'id, email, role, full_name, status, active, last_login, created_at, updated_at'

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

async function invokeAdminFunction(name, body) {
  if (!supabase) return { error: 'Supabase is not configured.' }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Not authenticated.' }

  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  })

  if (error) return { error: error.message || 'Request failed.' }
  if (data?.error) return { error: data.error }
  return { data }
}

export async function fetchAllStaffProfiles() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_ADMIN_FIELDS)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function createStaffUser(payload) {
  return invokeAdminFunction('admin-create-user', payload)
}

export async function updateStaffUser(payload) {
  return invokeAdminFunction('admin-update-user', payload)
}

export function formatLastLogin(value) {
  if (!value) return '—'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '—'
  const pad = n => String(n).padStart(2, '0')
  const mm = pad(dt.getMonth() + 1)
  const dd = pad(dt.getDate())
  const yyyy = dt.getFullYear()
  let hours = dt.getHours()
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12 || 12
  return `${mm}/${dd}/${yyyy} ${hours}:${pad(dt.getMinutes())} ${ampm}`
}

export function statusLabel(profile) {
  const status = String(profile?.status || '').toLowerCase()
  if (status === 'inactive') return 'Inactive'
  if (profile?.active === false) return 'Inactive'
  return 'Active'
}

export function isProfileActive(profile) {
  return statusLabel(profile) === 'Active'
}
