/** Tailwind CSS v3 config for the Agent Firewall pages.
 *
 * Design: a checkpoint for AI agents. Security-document paper, navy ink,
 * rubber-stamp verdicts, and a UV-lamp view that reveals hidden instructions.
 */
module.exports = {
  content: ["./app/templates/**/*.html", "./app/static/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        paper: "#EEF1F4",      // security paper
        card: "#FBFCFD",
        rule: "#C9D2DC",
        ink: { DEFAULT: "#14213D", 2: "#2A3A5C", muted: "#55637D" },
        cleared: { DEFAULT: "#0E7C66", soft: "#E1F1EC" },
        hold: { DEFAULT: "#B86E00", ink: "#7A4A00", soft: "#FBF0DC" },
        seized: { DEFAULT: "#C8102E", soft: "#FBE7EA" },
        uv: { DEFAULT: "#6D28D9", deep: "#160A2C", mid: "#2A1652", glow: "#D9CCFF", soft: "#EEE8FD" },
      },
      fontFamily: {
        display: ["Archivo", "Arial Narrow", "system-ui", "sans-serif"],
        sans: ["IBM Plex Sans", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "Cascadia Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
