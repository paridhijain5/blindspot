import type { Config } from "tailwindcss";

const config: Config = {
  theme: {
    extend: {
      colors: {
        paper: "#F3EEE4",
        "paper-deep": "#E9E2D3",
        ink: "#14120F",
        "ink-soft": "#4A453C",
        rule: "#CFC6B2",
        signal: "#D6361F",
        amber: "#C98A12",
        moss: "#2F5D46",
      },
      fontFamily: {
        display: ["var(--font-fraunces)"],
        sans: ["var(--font-instrument-sans)"],
        mono: ["var(--font-jetbrains-mono)"],
      },
    },
  },
};

export default config;
