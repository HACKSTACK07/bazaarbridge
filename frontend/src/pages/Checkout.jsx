import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function Checkout() {
  const [cart, setCart] = useState({ items: [] })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [checkingPin, setCheckingPin] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  const [priceChangedData, setPriceChangedData] = useState(null)
  const [outOfStockItems, setOutOfStockItems] = useState([])
  const [pinCheckResult, setPinCheckResult] = useState(null)
  const [modePreferences, setModePreferences] = useState({})
  const navigate = useNavigate()

  const fetchCart = useCallback(async () => {
    try {
      const res = await api.get('/cart')
      setCart(res)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCart()
  }, [fetchCart])

  useEffect(() => {
    const prefs = {}
    cart.items.forEach(item => {
      if (item.reservation_id) {
        prefs[item.reservation_id] = 'standard'
      }
    })
    setModePreferences(prefs)
    setPinCheckResult(null)
  }, [cart.items])

  const handlePinCheck = async (pinCode) => {
    if (!pinCode || pinCode.length !== 6) return
    setCheckingPin(true)
    setError('')
    try {
      const res = await api.post('/check-pin', { pin_code: pinCode })
      setPinCheckResult(res)
    } catch (err) {
      setError(err.body?.message ?? 'Failed to check PIN')
      console.error(err)
    } finally {
      setCheckingPin(false)
    }
  }

  const handlePinBlur = (e) => {
    const pinCode = e.target.value
    if (pinCode && pinCode.length === 6) {
      handlePinCheck(pinCode)
    }
  }

  const handleModeChange = (reservationId, mode) => {
    setModePreferences(prev => ({ ...prev, [reservationId]: mode }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setPriceChangedData(null)
    setOutOfStockItems([])
    setSubmitting(true)

    const formData = new FormData(e.target)
    const pinCode = formData.get('pin_code')
    const couponCode = formData.get('coupon_code') || undefined

    const reservationIds = cart.items
      .filter(item => item.reservation_id)
      .map(item => item.reservation_id)

    const finalModePreferences = {}
    reservationIds.forEach(id => {
      finalModePreferences[id] = modePreferences[id] || 'standard'
    })

    try {
      const res = await api.post('/orders', {
        reservation_ids: reservationIds,
        address: { pin_code: pinCode },
        mode_preferences: finalModePreferences,
        coupon_code: couponCode
      })
      setSuccess(res)
    } catch (err) {
      if (err.code === 'PRICE_CHANGED') {
        setPriceChangedData(err.body.reservations)
        setError('Some prices have changed. Please review and confirm.')
      } else if (err.code === 'OUT_OF_STOCK') {
        setOutOfStockItems(err.body.reservations || [])
        setError('Some items are out of stock. Please choose another dealer.')
      } else if (err.code === 'RESERVATION_EXPIRED') {
        setError('Reservation expired. Re-reserving...')
        await reReserveAndRetry()
      } else if (err.code === 'QUICK_NOT_AVAILABLE') {
        setError('Quick delivery not available for some items. Please adjust mode preferences.')
      } else {
        setError(err.body?.message ?? 'Checkout failed. Please try again.')
      }
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const reReserveAndRetry = async () => {
    try {
      for (const item of cart.items) {
        if (item.reservation_id) {
          await api.post('/cart/release', { reservation_id: item.reservation_id })
        }
      }
      await fetchCart()
      await handleSubmit(new Event('submit'))
    } catch (err) {
      setError('Failed to re-reserve. Please try again.')
      console.error(err)
    }
  }

  const handlePriceChangedConfirm = async () => {
    setError('')
    setSubmitting(true)
    try {
      for (const r of priceChangedData) {
        await api.post('/cart/release', { reservation_id: r.reservation_id })
      }
      await fetchCart()
      const formData = new FormData(document.getElementById('checkout-form'))
      const pinCode = formData.get('pin_code')
      const couponCode = formData.get('coupon_code') || undefined

      const reservationIds = cart.items
        .filter(item => item.reservation_id)
        .map(item => item.reservation_id)

      const finalModePreferences = {}
      reservationIds.forEach(id => {
        finalModePreferences[id] = modePreferences[id] || 'standard'
      })

      const res = await api.post('/orders', {
        reservation_ids: reservationIds,
        address: { pin_code: pinCode },
        mode_preferences: finalModePreferences,
        coupon_code: couponCode
      })
      setSuccess(res)
      setPriceChangedData(null)
    } catch (err) {
      setError(err.body?.message ?? 'Order failed after price update')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleOutOfStockConfirm = async () => {
    setError('')
    setSubmitting(true)
    try {
      for (const item of cart.items) {
        if (item.reservation_id) {
          await api.post('/cart/release', { reservation_id: item.reservation_id })
        }
      }
      await fetchCart()
      setOutOfStockItems([])
      setError('Released holds for out-of-stock items. Please update your cart.')
    } catch (err) {
      setError('Failed to release holds')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
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

  if (success) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center py-12">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Order Placed!</h1>
          <p className="mt-2 text-gray-600">Your order has been confirmed.</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Details</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Order ID</dt>
              <dd className="font-medium font-mono">{success.order_id}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Total Amount</dt>
              <dd className="font-medium">{formatPaise(success.total_amount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Delivery Fee</dt>
              <dd className="font-medium">{formatPaise(success.delivery_fee_total)}</dd>
            </div>
          </dl>

          {success.groups && success.groups.length > 0 && (
            <div className="mt-6 space-y-4">
              <h3 className="font-medium text-gray-900">Fulfilment Groups</h3>
              {success.groups.map((group) => (
                <div key={group.group_id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{group.mode} delivery</span>
                    <span className="text-sm text-gray-500">{formatPaise(group.fee_total)}</span>
                  </div>
                  <div className="mt-2 text-sm text-gray-500">
                    ETA: {group.eta_window_start ? new Date(group.eta_window_start).toLocaleString() : '—'} to{' '}
                    {group.eta_window_end ? new Date(group.eta_window_end).toLocaleString() : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => navigate('/orders')}
            className="mt-6 w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
          >
            View Order
          </button>
        </div>
      </div>
    )
  }

  const itemsTotal = cart.items.reduce((sum, item) => sum + (item.price_snapshot || 0) * item.quantity, 0)

  const getGroupInfo = (item) => {
    if (!item.reservation_id || !pinCheckResult) return null
    // In a real implementation, this would map items to groups
    // For now, we'll use the pinCheckResult to show available modes per item type
    return pinCheckResult
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Checkout</h1>
        <p className="mt-1 text-gray-600">Review your order and provide delivery details.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      {priceChangedData && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg space-y-2" role="alert">
          <p className="font-medium">Prices have changed for the following items:</p>
          <ul className="list-disc list-inside space-y-1 text-sm">
            {priceChangedData.map((r) => (
              <li key={r.reservation_id}>
                Reservation {r.reservation_id.slice(0, 8)}: new price {formatPaise(r.current_price_paise)}
              </li>
            ))}
          </ul>
          <div className="flex space-x-3 mt-3">
            <button
              type="button"
              onClick={handlePriceChangedConfirm}
              disabled={submitting}
              className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50"
            >
              Release holds & re-reserve at new prices
            </button>
            <button
              type="button"
              onClick={() => navigate('/cart')}
              className="px-4 py-2 border border-yellow-400 rounded-lg hover:bg-yellow-50"
            >
              Back to cart
            </button>
          </div>
        </div>
      )}

      {outOfStockItems.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg space-y-2" role="alert">
          <p className="font-medium">The following items are out of stock:</p>
          <ul className="list-disc list-inside space-y-1 text-sm">
            {outOfStockItems.map((r) => (
              <li key={r.reservation_id}>
                Reservation {r.reservation_id.slice(0, 8)} — choose another dealer
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={handleOutOfStockConfirm}
            disabled={submitting}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            Release holds & go back to cart
          </button>
        </div>
      )}

      <form id="checkout-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Summary</h2>
          <ul className="space-y-3" role="list">
            {cart.items.map((item) => (
              <li key={item.cart_item_id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm truncate max-w-xs">
                      {item.offer_id ? `Offer ${item.offer_id.slice(0, 8)}` : 'Product'}
                    </p>
                    <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                  </div>
                </div>
                <span className="font-medium text-gray-900">{formatPaise((item.price_snapshot || 0) * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-medium">{formatPaise(itemsTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Delivery Fee</span>
              <span className="font-medium">
                {pinCheckResult
                  ? formatPaise(pinCheckResult.standard_available ? 2900 : 0)
                  : 'Calculated at checkout'}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2 font-semibold text-lg">
              <span>Total</span>
              <span id="total-amount">
                {pinCheckResult
                  ? formatPaise(itemsTotal + (pinCheckResult.standard_available ? 2900 : 0))
                  : formatPaise(itemsTotal) + ' + delivery'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Delivery Address</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="pin_code" className="block text-sm font-medium text-gray-700 mb-1">
                PIN Code <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="pin_code"
                  name="pin_code"
                  type="text"
                  required
                  pattern="[0-9]{6}"
                  placeholder="560001"
                  onBlur={handlePinBlur}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-10"
                />
                {checkingPin && (
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">6-digit PIN code for delivery availability check</p>
            </div>

            {pinCheckResult && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-medium text-blue-900 mb-3">Delivery Options</h3>
                <div className="space-y-3">
                  {cart.items.map((item) => {
                    if (!item.reservation_id) return null
                    const reservationId = item.reservation_id
                    const isHubItem = false
                    const quickAvailable = pinCheckResult.quick_available && isHubItem
                    const standardAvailable = pinCheckResult.standard_available

                    return (
                      <div key={reservationId} className="border border-gray-200 rounded-lg p-4">
                        <p className="font-medium text-gray-900 mb-2">
                          {item.offer_id ? `Offer ${item.offer_id.slice(0, 8)}` : 'Product'} — {item.quantity} unit(s)
                        </p>
                        <div className="space-y-2">
                          <label className="flex items-center space-x-3 cursor-pointer">
                            <input
                              type="radio"
                              name={`mode-${reservationId}`}
                              value="standard"
                              checked={modePreferences[reservationId] === 'standard'}
                              onChange={() => handleModeChange(reservationId, 'standard')}
                              disabled={!standardAvailable || submitting}
                              className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                            />
                            <div className="flex-1">
                              <span className="font-medium text-gray-900">Standard Delivery</span>
                              <span className="ml-2 text-sm text-gray-500">
                                {itemsTotal >= 99900 ? 'FREE' : formatPaise(2900)}
                              </span>
                            </div>
                          </label>
                          {quickAvailable && (
                            <label className="flex items-center space-x-3 cursor-pointer">
                              <input
                                type="radio"
                                name={`mode-${reservationId}`}
                                value="quick"
                                checked={modePreferences[reservationId] === 'quick'}
                                onChange={() => handleModeChange(reservationId, 'quick')}
                                disabled={submitting}
                                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                              />
                              <div className="flex-1">
                                <span className="font-medium text-gray-900">Quick Delivery</span>
                                <span className="ml-2 text-sm text-gray-500">{formatPaise(4900)}</span>
                              </div>
                            </label>
                          )}
                          {!quickAvailable && standardAvailable && (
                            <p className="text-sm text-gray-500 ml-6">Quick delivery not available for this PIN code</p>
                          )}
                          {!standardAvailable && (
                            <p className="text-sm text-red-600 ml-6">No delivery options available for this PIN code</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="coupon_code" className="block text-sm font-medium text-gray-700 mb-1">
                Coupon Code (optional)
              </label>
              <input
                id="coupon_code"
                name="coupon_code"
                type="text"
                placeholder="SAVE10"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="flex space-x-3">
          <button
            type="button"
            onClick={() => navigate('/cart')}
            className="flex-1 py-3 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
          >
            Back to Cart
          </button>
          <button
            type="submit"
            disabled={submitting || cart.items.length === 0}
            className="flex-1 py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Placing Order...' : 'Place Order'}
          </button>
        </div>
      </form>
    </div>
  )
}