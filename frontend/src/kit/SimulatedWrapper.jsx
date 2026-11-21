import React from 'react'

export function SimulatedWrapper({ featureFlag, label, children }) {
  const isEnabled = import.meta.env.VITE_FEATURE_FLAGS?.split(',').includes(featureFlag) ?? false

  if (!isEnabled) {
    return null
  }

  return (
    <div className="relative">
      <div className="absolute -top-3 left-0 z-10">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
          SIMULATED / SAMPLE DATA
        </span>
      </div>
      <div className="border-2 border-yellow-300 rounded-lg p-4 bg-yellow-50">
        <div className="mb-2 text-sm font-medium text-yellow-700">{label}</div>
        {children}
      </div>
    </div>
  )
}

export default SimulatedWrapper