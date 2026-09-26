import { Epilogue, Work_Sans } from "next/font/google";

// Design system fonts: Epilogue for headings, Work Sans for body, labels and
// tabular numbers. Exposed as CSS variables consumed by globals.css @theme.
export const epilogue = Epilogue({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-epilogue",
  display: "swap",
});

export const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-work-sans",
  display: "swap",
});
