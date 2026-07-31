export const metadata = {
  title: "Crazy Sajangnim Backend",
  description: "Product collection and catalog service.",
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
