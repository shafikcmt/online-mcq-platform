import { Redirect } from "expo-router";

import { useAuth } from "@/auth/provider";
import { useLanguage } from "@/i18n/provider";

/** `/` (app start, or any link to the root) → the right area for the current state. */
export default function Index() {
  const { chosen } = useLanguage();
  const { status } = useAuth();
  if (!chosen) return <Redirect href="/language" />;
  return <Redirect href={status === "signedIn" ? "/home" : "/login"} />;
}
