export const BRAND = {
  colors: {
    ink: "#0A0A0A",
    paper: "#F5F5F5",
    grey900: "#1F1F1F",
    grey500: "#7A7A7A",
    grey200: "#D9D9D9",
  },
  fonts: {
    display: {
      family: "Source Serif 4",
      cssVar: "--font-display",
    },
    ui: {
      family: "Helvetica, Arial, sans-serif",
      cssVar: "--font-ui",
    },
  },
  logoSrc: "/brand/zinolt-logo-white.png",
  iconSrc: "/brand/zinolt-icon.jpg",
} as const;

export type Brand = typeof BRAND;
