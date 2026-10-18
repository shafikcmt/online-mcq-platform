import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const params = await searchParams;
  // Only same-site relative paths are allowed as a redirect target.
  const next = params.next && /^\/(?!\/)/.test(params.next) ? params.next : "/dashboard";
  return <LoginForm next={next} expired={params.expired === "1"} />;
}
