/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Wayfinder Extension Dark Theme - Exact Figma colors
        container: {
          L0: '#050505',      // Deep black - containerL0
          L1: '#0e0e0f',      // Dark gray (main bg) - containerL1
          L2: '#1c1c1f',      // Medium gray (cards) - containerL2
          L3: '#2a2a2e',      // Light gray (elevated) - containerL3
        },
        text: {
          high: '#cacad6',    // High contrast text - textHigh
          low: '#7f7f87',     // Low contrast text - textLow
          white: '#ffffff',   // Pure white - solid neutrals 100
        },
        icon: {
          high: '#cacad6',    // High contrast icons - iconHigh
          mid: '#a3a3ad',     // Mid contrast icons - iconMid
          low: '#7f7f87',     // Low contrast icons - iconLow
        },
        accent: {
          teal: {
            primary: '#2dd3be',    // rgb(45, 211, 190) - Teal primary
            secondary: '#0d9085',  // rgb(13, 144, 133) - Teal secondary
            tertiary: '#bc123c',   // rgb(188, 18, 60) - Red accent
          },
          blue: {
            DEFAULT: '#0055fe',    // rgb(0, 85, 254) - Blue accent
            light: '#6a82fc',      // rgb(106, 130, 252) - Blue light
          },
          gradient: {
            from: '#f7c3a1',       // Gradient start - peach
            to: '#df9be8',         // Gradient end - purple
          },
        },
        stroke: {
          low: 'rgba(202, 202, 214, 0.08)',   // strokeLow
          high: 'rgba(202, 202, 214, 0.32)',  // strokeHigh
        },
        border: {
          subtle: 'rgba(202, 202, 214, 0.08)',
          default: 'rgba(255, 255, 255, 0.2)',
          emphasis: 'rgba(202, 202, 214, 0.32)',
        },
        semantic: {
          success: {
            DEFAULT: 'rgba(211, 255, 202, 0.8)',
            solid: '#22c55e',
          },
          warning: {
            DEFAULT: '#fcb823',    // rgb(252, 184, 35)
            solid: '#f59e0b',
          },
          error: {
            DEFAULT: '#f23f5d',    // rgb(242, 63, 93)
            solid: '#ef4444',
          },
          info: {
            DEFAULT: '#6a82fc',    // rgb(106, 130, 252)
            solid: '#3b82f6',
          },
        },
      },
      fontFamily: {
        sans: ['Rubik', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        rubik: ['Rubik', 'Albert Sans', 'Inter', 'sans-serif'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fragment Mono', 'monospace'],
      },
      fontSize: {
        // Extension typography system
        'display': ['60px', { lineHeight: '1.2', fontWeight: '700' }],
        'h1': ['50px', { lineHeight: '1.2', fontWeight: '700' }],
        'h2': ['42px', { lineHeight: '1.2', fontWeight: '700' }],
        'h3': ['35px', { lineHeight: '1.3', fontWeight: '700' }],
        'h4': ['29px', { lineHeight: '1.3', fontWeight: '700' }],
        'h5': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'h6': ['17px', { lineHeight: '1.4', fontWeight: '700' }],
        'p-xxlarge': ['24px', { lineHeight: '1.5', fontWeight: '400' }],
        'p-xlarge': ['20px', { lineHeight: '1.5', fontWeight: '400' }],
        'p-large': ['17px', { lineHeight: '1.5', fontWeight: '400' }],
        'p-large-bold': ['17px', { lineHeight: '1.5', fontWeight: '700' }],
        'p-normal': ['14px', { lineHeight: '1.4', fontWeight: '400' }],
        'p-small': ['12px', { lineHeight: '1.4', fontWeight: '400' }],
        'caption': ['11px', { lineHeight: '1.4', fontWeight: '400' }],
        'caption-bold': ['11px', { lineHeight: '1.4', fontWeight: '700' }],
        // Standard size scale
        'xs': ['0.75rem', { lineHeight: '1.4' }],      // 12px
        'sm': ['0.875rem', { lineHeight: '1.4' }],     // 14px
        'base': ['1rem', { lineHeight: '1.5' }],       // 16px
        'lg': ['1.125rem', { lineHeight: '1.5' }],     // 18px
        'xl': ['1.25rem', { lineHeight: '1.5' }],      // 20px
        '2xl': ['1.5rem', { lineHeight: '1.4' }],      // 24px
      },
      spacing: {
        // Extension spacing system
        'xs': '4px',
        'sm': '8px',
        'md': '16px',
        'lg': '24px',
        'xl': '32px',
        '2xl': '48px',
      },
      borderRadius: {
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.4)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
        'card': '0px 1726px 483px 0px rgba(0, 0, 0, 0.01), 0px 1105px 442px 0px rgba(0, 0, 0, 0.04), 0px 621px 373px 0px rgba(0, 0, 0, 0.15), 0px 276px 276px 0px rgba(0, 0, 0, 0.26), 0px 69px 152px 0px rgba(0, 0, 0, 0.29)',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #f7c3a1, #df9be8)',
        'gradient-teal': 'linear-gradient(135deg, #2dd3be, #0d9085)',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'slide-in': 'slideIn 0.3s ease',
      },
      keyframes: {
        slideIn: {
          'from': {
            transform: 'translateY(20px)',
            opacity: '0',
          },
          'to': {
            transform: 'translateY(0)',
            opacity: '1',
          },
        },
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
