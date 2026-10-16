/** Tailwind CSS v3 config for the Agent Firewall pages.
 *
 * Design: an operator's desk tool, not a landing page. Neutral ink on a
 * cool paper ground, one blue accent for things you can act on, and amber /
 * red only where a call is held or blocked. Evidence is marked up the way a
 * person would do it on paper: with a highlighter.
 */
module.exports = {
  content: ["./app/templates/**/*.html", "./app/static/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        paper: "#F1F2EE",
        panel: "#FBFBF9",
        well: "#E8EAE4",
        rule: { DEFAULT: "#D6D9D2", strong: "#B9BDB4" },
        ink: { DEFAULT: "#1C1F24", 2: "#3B4048", muted: "#666C74" },
        accent: { DEFAULT: "#2D57B5", soft: "#E3E9F6" },
        ok: { DEFAULT: "#2F6B4F", soft: "#E4EEE8" },
        hold: { DEFAULT: "#9E560E", soft: "#F8EBD9", line: "#D99A4E" },
        stop: { DEFAULT: "#B42318", soft: "#F9E6E3", line: "#E0857C" },
        marker: "#FFE27A",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "Cascadia Code", "Consolas", "monospace"],
        num: ["Archivo", "IBM Plex Sans", "system-ui", "sans-serif"],
      },
      borderRadius: { tag: "3px", box: "6px", panel: "8px" },
    },
  },
  plugins: [],
};
