import { api } from "@/api/client";
import type { OtpPurpose, VerifyResponse } from "@/auth/types";

/** Public auth endpoints used before there is a session (docs/API_PLAN.md §2). */
export function requestOtp(mobileNumber: string, purpose: OtpPurpose, language: string) {
  return api<{ detail: string }>("/auth/otp/request/", {
    method: "POST",
    body: { mobile_number: mobileNumber, purpose, language },
    auth: false,
  });
}

export function verifyOtp(mobileNumber: string, purpose: OtpPurpose, code: string) {
  return api<VerifyResponse>("/auth/otp/verify/", {
    method: "POST",
    body: { mobile_number: mobileNumber, purpose, code },
    auth: false,
  });
}

export function resetPassword(verificationToken: string, mobileNumber: string, newPassword: string) {
  return api<void>("/auth/password/reset/", {
    method: "POST",
    body: { verification_token: verificationToken, mobile_number: mobileNumber, new_password: newPassword },
    auth: false,
  });
}
