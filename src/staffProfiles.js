export const PROFILE_NAME_FIELDS = 'id, email, role, full_name, status, active, last_login, created_at, updated_at'
export const SALES_PERSON_NAME_NOT_SET = 'Name Not Set'
export const STAFF_NAME_REQUIRED_WARNING = 'Full Name is required for Sales Person selection.'
export const STAFF_ROLES = ['Admin', 'Staff']
export const ALL_STAFF_ROLES = ['Admin', 'Staff', 'Warehouse']

export function profileStatus(profile) {
  if (!profile) return 'inactive'
  const status = String(profile.status || '').toLowerCase()
  if (status === 'inactive') return 'inactive'
  if (status === 'active') return 'active'
  if (profile.active === false || profile.active === 'false' || profile.active === 0) return 'inactive'
  return 'active'
}

export function profileIsActive(profile) {
  return profileStatus(profile) === 'active'
}

export function staffFullName(profile) {
  return String(profile?.full_name || '').trim()
}

/** Sales Person label: profiles.full_name only, never email. */
export function staffSalesPersonLabel(profile) {
  const fullName = staffFullName(profile)
  return fullName || SALES_PERSON_NAME_NOT_SET
}

export function staffManagementNameWarning(profile) {
  if (!profileIsActive(profile)) return ''
  if (!STAFF_ROLES.includes(profile?.role)) return ''
  if (staffFullName(profile)) return ''
  return STAFF_NAME_REQUIRED_WARNING
}

export function salesStaffOptions(staffUsers) {
  return (staffUsers || [])
    .filter(p => p && STAFF_ROLES.includes(p.role) && profileIsActive(p))
    .sort((a, b) => staffSalesPersonLabel(a).localeCompare(staffSalesPersonLabel(b)))
}

export function salesStaffMissingFullName(staffUsers) {
  return salesStaffOptions(staffUsers).filter(p => !staffFullName(p))
}

export function resolveSalesPersonFields(salesPersonId, staffUsers) {
  if (!salesPersonId) return { sales_person_id: null, sales_person_name: '' }
  const staff = (staffUsers || []).find(u => String(u.id) === String(salesPersonId))
  return {
    sales_person_id: salesPersonId,
    sales_person_name: staff ? staffFullName(staff) : '',
  }
}

export function orderSalesPersonDisplay(order, staffUsers) {
  if (order?.sales_person_id) {
    const staff = (staffUsers || []).find(u => String(u.id) === String(order.sales_person_id))
    if (staff) return staffSalesPersonLabel(staff)
    return SALES_PERSON_NAME_NOT_SET
  }
  const saved = String(order?.sales_person_name || '').trim()
  if (saved && !saved.includes('@')) return saved
  return '—'
}

export function staffProfileFromSession(profile, session) {
  return {
    id: profile?.id || session?.user?.id || '',
    email: profile?.email || session?.user?.email || '',
    role: profile?.role || 'Admin',
    full_name: profile?.full_name || '',
    status: profileStatus(profile),
    active: profileIsActive(profile),
    last_login: profile?.last_login || null,
    display_name: profile?.display_name || '',
    name: profile?.name || '',
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
  }
}

export function canAccessPage(role, page) {
  const access = PAGE_ACCESS[role] || PAGE_ACCESS.Admin
  return access.includes(page)
}

export const PAGE_ACCESS = {
  Admin: ['Dashboard', 'Customers', 'Inventory', 'Purchase Orders', 'Orders', 'Invoice', 'Payments', 'Expenses', 'Reports', 'Settings'],
  Staff: ['Dashboard', 'Customers', 'Orders', 'Invoice', 'Payments', 'Expenses', 'Reports'],
  Warehouse: ['Dashboard', 'Inventory', 'Purchase Orders', 'Orders'],
}
