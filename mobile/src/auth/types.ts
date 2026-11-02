import type { Language } from "@/i18n";

/** `GET /me` — the student's own account (ProfileSerializer). Never shown to others. */
export type User = {
  id: number;
  mobile_number: string;
  full_name: string;
  email: string | null;
  preferred_language: Language;
  display_name: string;
  is_mobile_verified: boolean;
  date_joined: string;
};

export type AuthResponse = { user: User; access: string; refresh: string };

export type OtpPurpose = "registration" | "password_reset";

export type VerifyResponse = { verification_token: string; expires_at: string };

export type RegisterInput = {
  verification_token: string;
  mobile_number: string;
  full_name: string;
  password: string;
  email?: string;
};

export type ProfileUpdate = Partial<Pick<User, "full_name" | "email" | "display_name" | "preferred_language">>;
