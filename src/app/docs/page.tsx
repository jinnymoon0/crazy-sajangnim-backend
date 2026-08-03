import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/*
 * The reference lives at the service root now. Kept so existing links
 * to /docs still land on it.
 */
export default function ApiDocsPage() {
  redirect("/");
}
