import type { Metadata } from "next";
import { Markazi_Text, Vazirmatn } from "next/font/google";
import "./globals.css";

const vazirmatn = Vazirmatn({ subsets: ["arabic", "latin"], variable: "--font-ui", display: "swap" });
const markazi = Markazi_Text({ subsets: ["arabic", "latin"], weight: ["500", "700"], variable: "--font-title", display: "swap" });

export const metadata: Metadata = {
  title: "پنل متین",
  description: "مدیریت انتشار، پیام‌ها و آمار حساب‌های اجتماعی",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} ${markazi.variable}`}>
      <body>{children}</body>
    </html>
  );
}
