import type { Config } from 'tailwindcss'

import aspectRatio from '@tailwindcss/aspect-ratio'
import containerQueries from '@tailwindcss/container-queries'
import forms from '@tailwindcss/forms'
import lineClamp from '@tailwindcss/line-clamp'
import typography from '@tailwindcss/typography'

const config: Config = {
  content: [
    './src/public/**/*.{js,ts,jsx,tsx,vue, mdx}',
  ],
  darkMode: 'class',
  experimental: {
    matchVariant: true,
    optimizeUniversalDefaults: true,
  },
  theme: {
    extend: {
      colors: ({ theme }) => ({
        primary: theme('colors.blue.600'),
        secondary: theme('colors.gray.100'),
      }),
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [
    typography({
      className: 'prose',
      target: 'modern',
    }),
    forms({
      strategy: 'class',
    }),
    aspectRatio,
    containerQueries,
    lineClamp,
  ],
}

export default config
