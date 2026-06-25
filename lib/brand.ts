export const BRAND = {
  colors: {
    ink: "rgb(10, 10, 10)",
    paper: "rgb(245, 245, 245)",
    grey900: "rgb(31, 31, 31)",
    grey500: "rgb(122, 122, 122)",
    grey200: "rgb(217, 217, 217)",
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
