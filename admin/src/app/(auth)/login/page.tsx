import type { Metadata } from "next";

import { safeNextPath } from "@/lib/session";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const params = await searchParams;
  // Only same-site relative paths are allowed as a redirect target (see safeNextPath).
  const next = safeNextPath(params.next);
  return <LoginForm next={next} expired={params.expired === "1"} />;
}
