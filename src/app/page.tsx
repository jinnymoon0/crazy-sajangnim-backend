import { apiDocsEnabled } from "@/lib/api-docs";

import SwaggerViewer from "./docs/SwaggerViewer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Crazy Sajangnim Backend — API docs",
};

/*
 * The service root is the API reference. A backend that only answers to
 * the shop and the admin has nothing else to show, so opening it should
 * say what it can do.
 */
export default function ServiceIndexPage() {
  if (!apiDocsEnabled()) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 40 }}>
        <h1>Crazy Sajangnim Backend</h1>

        <p>
          Product collection and catalog service. The API reference is
          turned off on this deployment; unset ENABLE_API_DOCS to show
          it.
        </p>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#fff" }}>
      <SwaggerViewer />
    </main>
  );
}
