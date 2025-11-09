/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        bgDark: "#0a0f1a",
        panelDark: "#111827",
        accent: "#38bdf8",
        danger: "#ef4444",
        ok: "#10b981",
        neutral: "#6b7280"
      },
      boxShadow: {
        glow: "0 0 30px rgba(56,189,248,0.4)",
      },
      borderRadius: {
        card: "1rem",
      }
    },
  },
  plugins: [],
}
