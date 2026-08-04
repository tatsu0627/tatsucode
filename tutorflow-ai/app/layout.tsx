import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TutorFlow AI",
    template: "%s | TutorFlow AI",
  },
  description:
    "AI\u306e\u6559\u6750\u6848\u3092\u4eba\u304c\u691c\u7b97\u3057\u3066\u304b\u3089\u6388\u696d\u3067\u4f7f\u3046\u3001\u6570\u5b66\u30c1\u30e5\u30fc\u30bf\u30fc\u5411\u3051\u306e\u6388\u696d\u6e96\u5099\u30c4\u30fc\u30eb\u3002",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
