export const metadata = {
  title: 'Audico WhatsApp Agent',
  description: 'AI-powered WhatsApp sales assistant for Audico',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
