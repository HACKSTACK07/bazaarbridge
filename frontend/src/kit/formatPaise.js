export function formatPaise(paise) {
  if (paise === null || paise === undefined) {
    return '₹0'
  }

  const rupees = paise / 100
  const formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

  return `₹${formatted}`
}

export default formatPaise