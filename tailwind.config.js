/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Same brand palette as the storefront (lib/theme.ts / tailwind.config.js there) — one brand, three apps.
        brand: {
          50: "#fff0f5",
          100: "#ffe0eb",
          200: "#ffc2d4",
          300: "#ff94b3",
          400: "#ff5585",
          500: "#ff1a5e",
          600: "#e6004a",
          700: "#c2003d",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        display: ["var(--font-playfair)", "serif"],
      },
      keyframes: {
        slideUp: {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "slide-up": "slideUp 0.18s ease-out",
      },
    },
  },
  plugins: [],
};
