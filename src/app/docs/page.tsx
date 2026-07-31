import { notFound } from "next/navigation";

import { apiDocsEnabled } from "@/lib/api-docs";

import SwaggerViewer from "./SwaggerViewer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Crazy Sajangnim Backend — API docs",
};

export default function ApiDocsPage() {
  if (!apiDocsEnabled()) {
    notFound();
  }

  return (
    <main style={{ minHeight: "100vh", background: "#fff" }}>
      <SwaggerViewer />
    </main>
  );
}
