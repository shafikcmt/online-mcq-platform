import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type TextInputInstance } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { isApiError } from "@/api/errors";
import type { OtpPurpose } from "@/auth/types";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { OtpInput } from "@/components/otp-input";
import { useToast } from "@/components/toast";
import { useLanguage } from "@/i18n/provider";
import { formatBdMobile } from "@/lib/phone";
import { localizeDigits } from "@/lib/text";
import { colors, space } from "@/theme";

import { requestOtp, verifyOtp } from "./api";
import { RESEND_SECONDS } from "./config";


type Props = {
  purpose: OtpPurpose;
  mobileNumber: string;
  onVerified: (verificationToken: string) => void;
  onChangeNumber: () => void;
};

/** Step 2: the 6-digit SMS code, with a resend countdown. */
export function OtpStep({ purpose, mobileNumber, onVerified, onChangeNumber }: Props) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const notify = useToast();
  const input = useRef<TextInputInstance>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, []);

  async function verify(value = code) {
    if (busy) return;
    setFailure(null);
    if (value.length !== 6) {
      setError(t("auth:otp.incomplete"));
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const result = await verifyOtp(mobileNumber, purpose, value);
      onVerified(result.verification_token);
    } catch (caught) {
      const remaining = isApiError(caught) ? caught.details.attempts_remaining : undefined;
      const message = describeError(caught, t);
      setError(typeof remaining === "number" ? `${message} ${t("auth:otp.attemptsLeft", { count: remaining, n: localizeDigits(remaining, language) })}` : message);
      setCode("");
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setFailure(null);
    setResending(true);
    try {
      await requestOtp(mobileNumber, purpose, language);
      setCode("");
      setError(undefined);
      setWait(RESEND_SECONDS);
      notify(t("auth:otp.resent"));
    } catch (caught) {
      if (isApiError(caught) && caught.retryAfter) setWait(caught.retryAfter);
      setFailure(describeError(caught, t));
    } finally {
      setResending(false);
    }
  }

  const phone = localizeDigits(formatBdMobile(mobileNumber), language);
  return (
    <View style={styles.wrap}>
      <AppText color={colors.inkMuted}>
        {t(purpose === "password_reset" ? "auth:otp.sentIfRegistered" : "auth:otp.sentTo", { phone })}
      </AppText>
      {failure ? <Banner tone="error" message={failure} /> : null}
      <OtpInput ref={input} value={code} onChange={setCode} label={t("auth:otp.label")} error={error} editable={!busy} onComplete={(value) => void verify(value)} />
      <Button label={t("auth:otp.verify")} onPress={() => void verify()} loading={busy} />
      <View style={styles.links}>
        <Button
          variant="ghost"
          compact
          label={wait > 0 ? t("auth:otp.resendIn", { seconds: localizeDigits(wait, language) }) : t("auth:otp.resend")}
          onPress={resend}
          disabled={wait > 0 || busy}
          loading={resending}
        />
        <Button variant="ghost" compact label={t("auth:otp.changeNumber")} onPress={onChangeNumber} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space.sm },
});
