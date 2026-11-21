import { useState, useEffect, useCallback } from 'react'
import { api } from '../kit/api'

export default function Addresses() {
  const [addresses, setAddresses] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(new Set())
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [formData, setFormData] = useState({
    label: 'Home',
    recipient_name: '',
    phone: '',
    line1: '',
    line2: '',
    landmark: '',
    city: '',
    state: '',
    pin_code: '',
    instructions: '',
    is_default: false,
  })
  const [error, setError] = useState('')

  const fetchAddresses = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/addresses')
      setAddresses(res ?? [])
    } catch (err) {
      setError(err.body?.message ?? 'Failed to load addresses')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAddresses()
  }, [fetchAddresses])

  const resetForm = () => {
    setFormData({
      label: editing ? editing.label : 'Home',
      recipient_name: editing?.recipient_name ?? '',
      phone: editing?.phone ?? '',
      line1: editing?.line1 ?? '',
      line2: editing?.line2 ?? '',
      landmark: editing?.landmark ?? '',
      city: editing?.city ?? '',
      state: editing?.state ?? '',
      pin_code: editing?.pin_code ?? '',
      instructions: editing?.instructions ?? '',
      is_default: editing?.is_default ?? false,
    })
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await api.put(`/addresses/${editing.address_id}`, formData)
      } else {
        await api.post('/addresses', formData)
      }
      setShowForm(false)
      setEditing(null)
      fetchAddresses()
    } catch (err) {
      setError(err.body?.message ?? 'Failed to save address')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (addressId) => {
    if (!window.confirm('Delete this address?')) return
    setDeleting(prev => new Set(prev).add(addressId))
    try {
      await api.delete(`/addresses/${addressId}`)
      fetchAddresses()
    } catch (err) {
      setError(err.body?.message ?? 'Failed to delete address')
      console.error(err)
    } finally {
      setDeleting(prev => {
        const next = new Set(prev)
        next.delete(addressId)
        return next
      })
    }
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditing(null)
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/4" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/4" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Saved Addresses</h1>
          <p className="mt-1 text-gray-600">Manage your delivery addresses. PIN code determines Quick/Standard availability.</p>
        </div>
        <button
          onClick={() => { setEditing(null); resetForm(); }}
          className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
        >
          Add Address
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{editing ? 'Edit Address' : 'Add Address'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                <select
                  value={formData.label}
                  onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Home">Home</option>
                  <option value="Work">Work</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Make default
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_default}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_default: e.target.checked }))}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Set as default address</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Name *</label>
              <input
                type="text"
                value={formData.recipient_name}
                onChange={(e) => setFormData(prev => ({ ...prev, recipient_name: e.target.value }))}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1 *</label>
              <input
                type="text"
                value={formData.line1}
                onChange={(e) => setFormData(prev => ({ ...prev, line1: e.target.value }))}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
              <input
                type="text"
                value={formData.line2}
                onChange={(e) => setFormData(prev => ({ ...prev, line2: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Landmark</label>
              <input
                type="text"
                value={formData.landmark}
                onChange={(e) => setFormData(prev => ({ ...prev, landmark: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State *</label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PIN Code *</label>
                <input
                  type="text"
                  value={formData.pin_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, pin_code: e.target.value }))}
                  required
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Instructions</label>
              <textarea
                value={formData.instructions}
                onChange={(e) => setFormData(prev => ({ ...prev, instructions: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex space-x-3 pt-4 border-t border-gray-200">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : (editing ? 'Update' : 'Add')}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-4">
        {addresses.length === 0 ? (
          <div className="text-center py-12">
            <svg className="mx-auto h-16 w-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 2 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">No addresses saved</h3>
            <p className="mt-2 text-gray-500">Add your first address to speed up checkout.</p>
          </div>
        ) : (
          addresses.map((addr) => (
            <div key={addr.address_id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full
                      {addr.label === 'Home' ? 'bg-green-100 text-green-800' :
                       addr.label === 'Work' ? 'bg-blue-100 text-blue-800' :
                       'bg-gray-100 text-gray-800'}">
                      {addr.label}
                    </span>
                    {addr.is_default && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">Default</span>
                    )}
                  </div>
                  <p className="mt-2 font-medium text-gray-900">{addr.recipient_name}</p>
                  <p className="text-sm text-gray-500">{addr.phone}</p>
                  <p className="text-sm text-gray-600 mt-1">{addr.line1}{addr.line2 ? `, ${addr.line2}` : ''}</p>
                  {addr.landmark && <p className="text-sm text-gray-500">Near: {addr.landmark}</p>}
                  <p className="text-sm text-gray-600">{addr.city}, {addr.state} - {addr.pin_code}</p>
                  {addr.instructions && <p className="text-xs text-gray-400 mt-1">Instructions: {addr.instructions}</p>}
                  <p className="mt-2 text-xs font-medium text-blue-600">
                    PIN {addr.pin_code} → checks Quick/Standard availability at checkout
                  </p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => { setEditing(addr); resetForm(); }}
                    className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(addr.address_id)}
                    disabled={deleting.has(addr.address_id)}
                    className="px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50"
                  >
                    {deleting.has(addr.address_id) ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}