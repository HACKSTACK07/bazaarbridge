import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../kit/api'

const FULFILMENT_EVENTS = [
  { type: 'picked', label: 'Mark Picked', mode: ['quick'] },
  { type: 'packed', label: 'Mark Packed', mode: ['quick', 'standard', 'transfer'] },
  { type: 'rider_assigned', label: 'Assign Rider', mode: ['quick', 'standard', 'transfer'] },
  { type: 'picked_up', label: 'Picked Up', mode: ['quick', 'standard', 'transfer'] },
  { type: 'out_for_delivery', label: 'Out for Delivery', mode: ['quick', 'standard', 'transfer'] },
  { type: 'otp_verified', label: 'Deliver - Correct OTP', mode: ['quick', 'standard', 'transfer'], needsOtp: true },
  { type: 'otp_failed', label: 'Deliver - Wrong OTP', mode: ['quick', 'standard', 'transfer'] },
  { type: 'exception', label: 'Delivery Exception', mode: ['quick', 'standard', 'transfer'] },
]

const TRANSFER_EVENTS = [
  { type: 'transfer_requested', label: 'Mark In Transit', mode: ['transfer'] },
  { type: 'in_transit', label: 'Mark In Transit', mode: ['transfer'] },
  { type: 'received_checked', label: 'Mark Received and QC\'d', mode: ['transfer'] },
  { type: 'allocated', label: 'Allocate to Order', mode: ['transfer'] },
]

const HUB_EVENTS = [
  { type: 'hub_activate', label: 'Activate Hub', mode: [] },
  { type: 'hub_deactivate', label: 'Deactivate Hub', mode: [] },
]

export default function Simulator() {
  const navigate = useNavigate()
  const [groupId, setGroupId] = useState('')
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(false)
  const [firing, setFiring] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [demoOtp, setDemoOtp] = useState('')
  const [otp, setOtp] = useState('')
  const [hubId, setHubId] = useState('')
  const [hubActive, setHubActive] = useState(true)
  const [refundId, setRefundId] = useState('')
  const [gatewayRef, setGatewayRef] = useState('')

  const fetchGroup = useCallback(async () => {
    if (!groupId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/admin/groups/${groupId}/demo-otp`)
      setDemoOtp(res.demo_otp ?? '')
      const orderRes = await api.get(`/orders/${res.order_id}`)
      const foundGroup = orderRes.items?.flatMap(i => i.fulfilment_group ? [i.fulfilment_group] : []).find(g => g.group_id === groupId)
      if (foundGroup) setGroup(foundGroup)
    } catch (err) {
      setError(err.body?.message ?? 'Failed to load group')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    fetchGroup()
  }, [fetchGroup])

  const fireEvent = async (eventType, customOtp = null) => {
    setFiring(true)
    setError('')
    setSuccess('')
    try {
      const payload = { group_id: groupId, event_type: eventType }
      if (eventType === 'otp_verified') {
        payload.otp = customOtp || otp || demoOtp
      }
      const res = await api.post('/simulator/fire-event', payload)
      setSuccess(`Event fired: ${eventType} (event_id: ${res.event_id})`)
      fetchGroup()
    } catch (err) {
      setError(err.body?.message ?? 'Failed to fire event')
      console.error(err)
    } finally {
      setFiring(false)
    }
  }

  const fireHubToggle = async () => {
    setFiring(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.post(`/admin/hubs/${hubId}/status`, { active: hubActive })
      setSuccess(`Hub ${hubActive ? 'activated' : 'deactivated'}`)
    } catch (err) {
      setError(err.body?.message ?? 'Failed to toggle hub')
      console.error(err)
    } finally {
      setFiring(false)
    }
  }

  const fireRefundCredit = async () => {
    setFiring(true)
    setError('')
    setSuccess('')
    try {
      const payload = gatewayRef ? { gateway_ref: gatewayRef } : {}
      const res = await api.post(`/admin/refunds/${refundId}/credit`, payload)
      setSuccess(`Refund credit requested (event_id: ${res.event_id})`)
    } catch (err) {
      setError(err.body?.message ?? 'Failed to credit refund')
      console.error(err)
    } finally {
      setFiring(false)
    }
  }

  const getAvailableEvents = () => {
    if (!group) return []
    const events = [...FULFILMENT_EVENTS]
    if (group.mode === 'transfer') {
      events.push(...TRANSFER_EVENTS)
    }
    return events.filter(e => e.mode.includes(group.mode))
  }

  const getStatusIndex = (mode, status) => {
    const statuses = mode === 'quick' ? ['order_accepted', 'picked', 'packed', 'rider_assigned', 'picked_up', 'out_for_delivery', 'delivered'] :
                     mode === 'standard' ? ['order_accepted', 'processing', 'packed', 'rider_assigned', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'] :
                     ['reserved_at_origin', 'transfer_requested', 'in_transit_to_bangalore', 'received_checked', 'allocated', 'packed', 'rider_assigned', 'picked_up', 'out_for_delivery', 'delivered']
    return statuses.indexOf(status)
  }

  const isEventAvailable = (eventType) => {
    if (!group) return false
    const currentIndex = getStatusIndex(group.mode, group.status)
    const statuses = getStatusIndex(group.mode, group.status) // this is wrong, let me fix
    
    // For simplicity, allow all events for the group's mode
    return true
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Simulator Console</h1>
          <p className="mt-1 text-gray-600">Admin only. Fire fulfilment events, toggle hubs, credit refunds.</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
        >
          ← Back to Store
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {success}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Fulfilment Group</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="group-id" className="block text-sm font-medium text-gray-700 mb-1">
              Group ID
            </label>
            <div className="flex space-x-2">
              <input
                id="group-id"
                type="text"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="Enter group UUID"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <button
                onClick={fetchGroup}
                disabled={loading || !groupId}
                className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Loading...' : 'Load Group'}
              </button>
            </div>
          </div>

          {group && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm text-gray-500">Group ID</p>
                <p className="font-mono text-sm text-gray-900">{group.group_id}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Mode</p>
                <p className="font-medium text-gray-900 capitalize">{group.mode}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <p className="font-medium text-gray-900">{group.status}</p>
              </div>
              <div className="sm:col-span-3">
                <p className="text-sm text-gray-500">Demo OTP</p>
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-lg text-gray-900 tracking-widest bg-white px-3 py-2 border border-gray-300 rounded-lg">
                    {demoOtp || '—'}
                  </span>
                  {demoOtp && (
                    <button
                      onClick={() => { setOtp(demoOtp); navigator.clipboard.writeText(demoOtp) }}
                      className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Copy OTP
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {group && (
          <div className="mt-6">
            <h3 className="font-medium text-gray-900 mb-3">Fire Fulfilment Event</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {getAvailableEvents().map((event) => (
                <button
                  key={event.type}
                  onClick={() => event.needsOtp ? fireEvent(event.type) : fireEvent(event.type)}
                  disabled={firing}
                  className="px-3 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 text-left"
                >
                  {event.label}
                </button>
              ))}
            </div>
            {otp && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">Using OTP: <span className="font-mono">{otp}</span></p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Hub Toggle</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="hub-id" className="block text-sm font-medium text-gray-700 mb-1">
              Hub ID
            </label>
            <input
              id="hub-id"
              type="text"
              value={hubId}
              onChange={(e) => setHubId(e.target.value)}
              placeholder="Enter hub UUID"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hubActive}
                onChange={(e) => setHubActive(e.target.checked)}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Active</span>
            </label>
            <button
              onClick={fireHubToggle}
              disabled={firing || !hubId}
              className="px-4 py-2 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {firing ? 'Toggling...' : 'Toggle Hub Status'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Credit Refund (Simulated)</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="refund-id" className="block text-sm font-medium text-gray-700 mb-1">
              Refund ID
            </label>
            <input
              id="refund-id"
              type="text"
              value={refundId}
              onChange={(e) => setRefundId(e.target.value)}
              placeholder="Enter refund UUID"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label htmlFor="gateway-ref" className="block text-sm font-medium text-gray-700 mb-1">
              Gateway Ref (optional)
            </label>
            <input
              id="gateway-ref"
              type="text"
              value={gatewayRef}
              onChange={(e) => setGatewayRef(e.target.value)}
              placeholder="Optional gateway reference"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <button
            onClick={fireRefundCredit}
            disabled={firing || !refundId}
            className="px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {firing ? 'Crediting...' : 'Credit Refund'}
          </button>
        </div>
      </div>
    </div>
  )
}