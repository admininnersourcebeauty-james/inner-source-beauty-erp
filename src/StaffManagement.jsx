import React, { useEffect, useMemo, useState } from 'react'
import {
  ALL_STAFF_ROLES,
  createStaffUser,
  fetchAllStaffProfiles,
  formatLastLogin,
  isProfileActive,
  isValidEmail,
  statusLabel,
  updateStaffUser,
} from './staffAdmin.js'
import { salesStaffMissingFullName, staffFullName, STAFF_NAME_REQUIRED_WARNING } from './staffProfiles.js'

const BLANK_ADD = {
  full_name: '',
  email: '',
  password: '',
  confirm_password: '',
  role: 'Staff',
  status: 'active',
}

function StaffModal({ title, children, onClose }) {
  return (
    <div className="restore-dialog-overlay staff-modal-overlay" onClick={onClose}>
      <div className="restore-dialog staff-modal" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function AddUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState(BLANK_ADD)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    if (!staffFullName(form)) return setError('Full Name is required.')
    if (!form.email.trim()) return setError('Email is required.')
    if (!isValidEmail(form.email)) return setError('Enter a valid email address.')
    if (!form.password || form.password.length < 8) return setError('Password must be at least 8 characters.')
    if (form.password !== form.confirm_password) return setError('Passwords do not match.')

    setBusy(true)
    const result = await createStaffUser({
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      password: form.password,
      confirm_password: form.confirm_password,
      role: form.role,
      status: form.status,
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onCreated?.()
    onClose()
  }

  return (
    <StaffModal title="Add User" onClose={onClose}>
      <form className="staff-modal-form" onSubmit={handleCreate}>
        <label>Full Name *
          <input value={form.full_name} onChange={e => setField('full_name', e.target.value)} placeholder="Full Name" />
        </label>
        <label>Email *
          <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="Email" />
        </label>
        <label>Password *
          <input type="password" value={form.password} onChange={e => setField('password', e.target.value)} placeholder="Minimum 8 characters" />
        </label>
        <label>Confirm Password *
          <input type="password" value={form.confirm_password} onChange={e => setField('confirm_password', e.target.value)} placeholder="Confirm Password" />
        </label>
        <label>Role *
          <select value={form.role} onChange={e => setField('role', e.target.value)}>
            {ALL_STAFF_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>Status
          <select value={form.status} onChange={e => setField('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="restore-dialog-actions">
          <button type="button" className="soft" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create User'}</button>
        </div>
      </form>
    </StaffModal>
  )
}

function EditUserModal({ user, currentUserId, onClose, onSaved }) {
  const isSelf = String(user.id) === String(currentUserId)
  const [form, setForm] = useState({
    full_name: user.full_name || '',
    role: user.role || 'Staff',
    status: isProfileActive(user) ? 'active' : 'inactive',
    password: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    if (!staffFullName(form)) return setError('Full Name is required.')
    if (isSelf && form.status === 'inactive') return setError('You cannot deactivate your own account.')
    if (form.password && form.password.length < 8) return setError('Password must be at least 8 characters.')

    setBusy(true)
    const payload = {
      userId: user.id,
      full_name: form.full_name.trim(),
      role: form.role,
      status: form.status,
    }
    if (form.password) payload.password = form.password

    const result = await updateStaffUser(payload)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onSaved?.()
    onClose()
  }

  return (
    <StaffModal title="Edit User" onClose={onClose}>
      <form className="staff-modal-form" onSubmit={handleSave}>
        <label>Full Name *
          <input value={form.full_name} onChange={e => setField('full_name', e.target.value)} placeholder="Full Name" />
        </label>
        <label>Email
          <input value={user.email || ''} readOnly disabled className="readonly-input" />
        </label>
        <label>Role *
          <select value={form.role} onChange={e => setField('role', e.target.value)}>
            {ALL_STAFF_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>Status
          <select
            value={form.status}
            onChange={e => setField('status', e.target.value)}
            disabled={isSelf}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        {isSelf && <p className="hint">Your own account cannot be set to Inactive.</p>}
        <label>Password Reset
          <input type="password" value={form.password} onChange={e => setField('password', e.target.value)} placeholder="Leave blank to keep current password" />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="restore-dialog-actions">
          <button type="button" className="soft" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </form>
    </StaffModal>
  )
}

export function StaffManagement({ currentUserId, reloadStaffUsers }) {
  const [profiles, setProfiles] = useState([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [statusError, setStatusError] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editUser, setEditUser] = useState(null)

  async function loadProfiles() {
    setBusy(true)
    try {
      const rows = await fetchAllStaffProfiles()
      setProfiles(rows || [])
      setStatus('')
      setStatusError(false)
    } catch (err) {
      setProfiles([])
      setStatus(err.message || 'Could not load staff profiles.')
      setStatusError(true)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    loadProfiles()
  }, [])

  async function handleSaved() {
    setStatus('Staff profile saved.')
    setStatusError(false)
    await loadProfiles()
    await reloadStaffUsers?.()
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(p => {
      const hay = [p.full_name, p.email, p.role, statusLabel(p)].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [profiles, search])

  const missingNames = useMemo(() => salesStaffMissingFullName(profiles), [profiles])

  return (
    <div className="panel staff-management-panel">
      <div className="staff-management-header">
        <div>
          <h2>Staff Management</h2>
          <p className="hint">Create and manage user accounts, roles, and access status.</p>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} disabled={busy}>+ Add User</button>
      </div>

      {missingNames.length > 0 && (
        <p className="field-error">Full Name is required for Sales Person selection.</p>
      )}
      {status && <p className={statusError ? 'field-error' : 'hint'}>{status}</p>}

      <div className="staff-management-toolbar">
        <input
          className="staff-search-input"
          placeholder="Search by name, email, or role..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="hint">{profiles.length === 0 ? 'No staff profiles found.' : 'No users match your search.'}</p>
      ) : (
        <div className="table-wrap staff-management-table">
          <table>
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const name = staffFullName(u)
                return (
                  <tr key={u.id}>
                    <td className="staff-name-cell">
                      {name ? name : (
                        ['Admin', 'Staff'].includes(u.role) && isProfileActive(u) ? (
                          <span className="field-error staff-name-warning-inline">{STAFF_NAME_REQUIRED_WARNING}</span>
                        ) : '—'
                      )}
                    </td>
                    <td>{u.email || '—'}</td>
                    <td>{u.role || '—'}</td>
                    <td>
                      <span className={`staff-status-badge ${isProfileActive(u) ? 'staff-status-active' : 'staff-status-inactive'}`}>
                        {statusLabel(u)}
                      </span>
                    </td>
                    <td>{formatLastLogin(u.last_login)}</td>
                    <td>
                      <button type="button" className="soft" disabled={busy} onClick={() => setEditUser(u)}>Edit</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onCreated={handleSaved}
        />
      )}
      {editUser && (
        <EditUserModal
          user={editUser}
          currentUserId={currentUserId}
          onClose={() => setEditUser(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
