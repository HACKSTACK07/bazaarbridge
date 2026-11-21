import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'
import { usePolling } from '../kit/usePolling'

const QUICK_STATUSES = ['order_accepted', 'picked', 'packed', 'rider_assigned', 'picked_up', 'out_for_delivery', 'delivered']
const STANDARD_STATUSES = ['order_accepted', 'processing', 'packed', 'rider_assigned', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered']
const TRANSFER_STATUSES = ['reserved_at_origin', 'transfer_requested', 'in_transit_to_bangalore', 'received_checked', 'allocated', 'packed', 'rider_assigned', 'picked_up', 'out_for_delivery', 'delivered']

const STATUS_LABELS = {
  order_accepted: 'Order Accepted',
  processing: 'Processing',
  picked: 'Picked',
  packed: 'Packed',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  reserved_at_origin: 'Reserved at Origin',
  transfer_requested: 'Transfer Requested',
  in_transit_to_bangalore: 'In Transit to Bangalore',
  received_checked: 'Received & QC\'d',
  allocated: 'Allocated to Order',
  cancelled: 'Cancelled',
  otp_failed: 'OTP Failed',
  exception: 'Exception',
}

const CANCELLABLE_STATUSES = [
  'order_accepted', 'picked', 'packed', 'rider_assigned',
  'reserved_at_origin', 'transfer_requested', 'in_transit_to_bangalore',
  'received_checked', 'allocated', 'processing'
]

export default function OrderTracking() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(new Set())
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchOrder = useCallback(async () => {
    try {
      const res = await api.get(`/orders/${id}`)
      setOrder(res)
      setError('')
    } catch (err) {
      if (err.status !== 404) {
        setError(err.body?.message ?? 'Failed to load order')
      }
      console.error(err)
    }
  }, [id])

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications?unread=true')
      const notifs = res ?? []
      setNotifications(notifs)
      setUnreadCount(notifs.length)
    } catch (err) {
      console.error('Failed to fetch notifications:', err)
    }
  }, [])

  useEffect(() => {
    fetchOrder()
  }, [fetchOrder])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  usePolling(fetchOrder, 15000)
  usePolling(fetchNotifications, 30000)

  const handleCancel = async (groupId, group) => {
    if (!window.confirm(`Cancel this ${group.mode} group? This action cannot be undone.`)) return
    setCancelling(prev => new Set(prev).add(groupId))
    try {
      await api.post(`/orders/${id}/items/${group.order_item_id}/cancel`, { request_key: `cancel-${Date.now()}` })
      fetchOrder()
    } catch (err) {
      if (err.code === 'ALREADY_CANCELLED_OR_TOO_LATE') {
        setError('Already dispatched — cannot cancel')
      } else {
        setError(err.body?.message ?? 'Cancellation failed')
      }
      console.error(err)
    } finally {
      setCancelling(prev => {
        const next = new Set(prev)
        next.delete(groupId)
        return next
      })
    }
  }

  const isCancellable = (group) => {
    return CANCELLABLE_STATUSES.includes(group.status)
  }

  const getStatusesForMode = (mode) => {
    switch (mode) {
      case 'quick': return QUICK_STATUSES
      case 'standard': return STANDARD_STATUSES
      case 'transfer': return TRANSFER_STATUSES
      default: return []
    }
  }

  const getStatusIndex = (mode, status) => {
    const statuses = getStatusesForMode(mode)
    return statuses.indexOf(status)
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-gray-200 rounded w-1/4" />
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="h-4 bg-gray-200 rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (error && !order) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Order not found</h3>
        <p className="mt-1 text-sm text-gray-500">{error}</p>
      </div>
    )
  }

  if (!order) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Order {order.order_id.slice(0, 8)}</h1>
          <p className="mt-1 text-gray-600">Placed {new Date(order.placed_at).toLocaleString()}</p>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/orders')}
            className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
          >
            ← Back to Orders
          </button>
          <div className="relative">
            <button className="relative p-2 text-gray-500 hover:text-gray-700" aria-label="Notifications">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {notifications.length > 0 && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                <div className="p-3 border-b border-gray-200">
                  <h3 className="font-medium text-gray-900">Notifications</h3>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {notifications.map((notif) => (
                    <div key={notif.notification_id} className="p-3 border-b border-gray-100 hover:bg-gray-50">
                      <p className="text-sm text-gray-900">{notif.message}</p>
                      <p className="text-xs text-gray-500 mt-1">{new Date(notif.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div>
          <dt className="text-sm text-gray-500">Order ID</dt>
          <dd className="font-mono text-sm text-gray-900">{order.order_id}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">Total Amount</dt>
          <dd className="font-semibold text-gray-900">{formatPaise(order.total_amount)}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">Delivery Fee</dt>
          <dd className="font-medium text-gray-900">{formatPaise(order.delivery_fee_total)}</dd>
        </div>
      </dl>

      {order.items && order.items.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-gray-900">Items</h2>
          {order.items.map((item) => (
            <div key={item.order_item_id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">
                      {item.offer_id ? `Offer ${item.offer_id.slice(0, 8)}` : 'Product'}
                    </h3>
                    <p className="text-sm text-gray-500">Qty: {item.quantity} • {formatPaise(item.paid_amount)}</p>
                    <p className="text-xs text-gray-400">Item status: {item.item_status}</p>
                  </div>
                </div>
                {item.delivery_otp && item.fulfilment_group && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-xs text-yellow-800 font-medium">SAMPLE DEMO OTP</p>
                    <p className="font-mono text-lg text-yellow-900 tracking-widest">{item.delivery_otp}</p>
                    <p className="text-xs text-yellow-700 mt-1">Share with delivery partner</p>
                  </div>
                )}
              </div>

              {item.fulfilment_group && (
                <div className="p-4">
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900 capitalize">{item.fulfilment_group.mode} delivery</span>
                      <span className="px-2 py-1 text-xs font-medium rounded-full
                        {item.fulfilment_group.status === 'delivered' ? 'bg-green-100 text-green-800' :
                         item.fulfilment_group.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                         'bg-blue-100 text-blue-800'}">
                        {STATUS_LABELS[item.fulfilment_group.status] ?? item.fulfilment_group.status}
                      </span>
                    </div>
                    {item.fulfilment_group.eta_window_start && item.fulfilment_group.eta_window_end && (
                      <p className="text-sm text-gray-500">
                        ETA: {new Date(item.fulfilment_group.eta_window_start).toLocaleString()} — {new Date(item.fulfilment_group.eta_window_end).toLocaleString()}
                      </p>
                    )}
                  </div>

                  <div className="border-t border-gray-100 pt-4">
                    <h4 className="font-medium text-gray-900 mb-3">Timeline</h4>
                    <div className="space-y-3">
                      {getStatusesForMode(item.fulfilment_group.mode).map((status, index) => {
                        const currentIndex = getStatusIndex(item.fulfilment_group.mode, item.fulfilment_group.status)
                        const isCompleted = index <= currentIndex
                        const isCurrent = index === currentIndex
                        const timelineEvent = item.fulfilment_group.timeline?.find(t => t.status === status)
                        return (
                          <div key={status} className="flex items-start space-x-3">
                            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                              isCompleted ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400'
                            } ${isCurrent ? 'ring-2 ring-blue-600 ring-offset-2' : ''}`}>
                              {isCompleted ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <span className="text-xs font-bold">{index + 1}</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 pt-1">
                              <p className={`text-sm ${isCompleted ? 'text-gray-900' : 'text-gray-400'} ${isCurrent ? 'font-medium' : ''}`}>
                                {STATUS_LABELS[status] ?? status}
                              </p>
                              {timelineEvent && (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {timelineEvent.note ? `${timelineEvent.note} • ` : ''}
                                  {new Date(timelineEvent.created_at).toLocaleString()}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {isCancellable(item.fulfilment_group) && item.fulfilment_group.status !== 'delivered' && item.fulfilment_group.status !== 'cancelled' && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <button
                        onClick={() => handleCancel(item.fulfilment_group.group_id, item.fulfilment_group)}
                        disabled={cancelling.has(item.fulfilment_group.group_id)}
                        className="w-full px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {cancelling.has(item.fulfilment_group.group_id) ? 'Cancelling...' : 'Cancel This Group'}
                      </button>
                    </div>
                  )}

                  {item.fulfilment_group.status === 'cancelled' || item.fulfilment_group.status === 'delivered' ? (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-sm text-gray-500 text-center">
                        {item.fulfilment_group.status === 'delivered'
                          ? 'This group has been delivered.'
                          : 'This group has been cancelled.'}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-sm text-gray-500 text-center">
                        Already dispatched — cannot cancel
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}