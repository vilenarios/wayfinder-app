/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Wayfinder Extension Dark Theme
        container: {
          L0: '#050505',      // Deep black
          L1: '#0e0e0f',      // Dark gray (main bg)
          L2: '#1c1c1f',      // Medium gray (cards)
          L3: '#2a2a2e',      // Light gray (elevated)
        },
        text: {
          high: '#cacad6',    // High contrast text
          low: '#7f7f87',     // Low contrast text
          white: '#ffffff',   // Pure white
        },
        icon: {
          high: '#cacad6',    // High contrast icons
          mid: '#a3a3ad',     // Mid contrast icons
          low: '#7f7f87',     // Low contrast icons
        },
        accent: {
          teal: {
            primary: '#2dd3be',    // rgb(45, 211, 190)
            secondary: '#0d9085',  // rgb(13, 144, 133)
          },
          blue: '#0055fe',         // rgb(0, 85, 254)
        },
        stroke: {
          low: 'rgba(202, 202, 214, 0.08)',
          high: 'rgba(202, 202, 214, 0.32)',
        },
        semantic: {
          success: 'rgba(211, 255, 202, 0.8)',
          warning: '#fcb823',      // rgb(252, 184, 35)
          error: '#f23f5d',        // rgb(242, 63, 93)
          info: '#6a82fc',         // rgb(106, 130, 252)
        },
      },
      fontFamily: {
        sans: ['Rubik', 'Inter', 'system-ui', 'sans-serif'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.4)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
        card: '0px 4px 16px rgba(0, 0, 0, 0.4)',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
      },
    },
  },
  plugins: [],
}
