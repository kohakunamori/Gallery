import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f9f9f9',
        surface: '#f9f9f9',
        'surface-container': '#eeeeee',
        'surface-container-low': '#f3f3f3',
        'surface-container-lowest': '#ffffff',
        'surface-container-high': '#e8e8e8',
        primary: '#005bb3',
        'primary-container': '#0073e0',
        'primary-fixed': '#d6e3ff',
        outline: '#717785',
        'outline-variant': '#c1c6d6',
        'on-surface': '#1a1c1c',
        'on-surface-variant': '#414754',
      },
      fontFamily: {
        headline: ['"Plus Jakarta Sans"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        ambient: '0 24px 60px rgba(26, 28, 28, 0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;
