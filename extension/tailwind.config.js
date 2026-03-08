/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./options.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    'status-indicator',
    'active',
    'inactive',
    'toggle-btn',
    'stop',
    'start',
    'bg-gray-100',
    'text-gray-500',
    'rounded',
    'shadow',
    'border-l-4',
    'border-blue-500',
    'border-yellow-500',
    'text-slate-300',
    'hover:bg-slate-800',
    'bg-green-600',
    'text-white',
    'text-slate-500',
    'text-slate-900',
    'text-green-400',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
