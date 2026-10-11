import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Archly — 把想法連成架構",
  description: "以節點、連線與自由手繪整理系統架構的互動白板。本地介面預覽，雲端協作待串接。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
