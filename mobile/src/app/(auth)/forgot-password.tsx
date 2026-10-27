import { router } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, View, type TextInputInstance } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError, fieldErrors } from "@/api/describe";
import { isApiError } from "@/api/errors";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { TextField } from "@/components/text-field";
import { resetPassword } from "@/features/auth/api";
import { OtpStep } from "@/features/auth/otp-step";
import { PhoneStep } from "@/features/auth/phone-step";
import { useLanguage } from "@/i18n/provider";
import { localizeDigits } from "@/lib/text";
import { space } from "@/theme";

type Step = { name: "phone"; notice?: string } | { name: "otp"; mobile: string } | { name: "password"; mobile: string; token: string };

/** Forgot password: mobile number → SMS code → new password → back to sign-in. The server
 * answers identically whether or not the number has an account. */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [step, setStep] = useState<Step>({ name: "phone" });
  const index = step.name === "phone" ? 1 : step.name === "otp" ? 2 : 3;
  return (
    <Screen>
      <PageHeader
        eyebrow={t("auth:stepOf", { current: localizeDigits(index, language), total: localizeDigits(3, language) })}
        title={step.name === "phone" ? t("auth:forgot.title") : step.name === "otp" ? t("auth:otp.title") : t("auth:forgot.newTitle")}
        subtitle={step.name === "phone" ? t("auth:forgot.subtitle") : undefined}
        onBack={step.name === "otp" ? () => setStep({ name: "phone" }) : undefined}
      />
      {step.name === "phone" ? (
        <PhoneStep purpose="password_reset" submitLabel={t("auth:register.sendCode")} notice={step.notice} onSent={(mobile) => setStep({ name: "otp", mobile })} />
      ) : step.name === "otp" ? (
        <OtpStep
          purpose="password_reset"
          mobileNumber={step.mobile}
          onVerified={(token) => setStep({ name: "password", mobile: step.mobile, token })}
          onChangeNumber={() => setStep({ name: "phone" })}
        />
      ) : (
        <NewPasswordStep mobile={step.mobile} token={step.token} onVerifyAgain={() => setStep({ name: "phone", notice: t("auth:register.verifyAgain") })} />
      )}
    </Screen>
  );
}

function NewPasswordStep({ mobile, token, onVerifyAgain }: { mobile: string; token: string; onVerifyAgain: () => void }) {
  const { t } = useTranslation();
  const confirmRef = useRef<TextInputInstance>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const next = {
      password: password ? undefined : t("required"),
      confirm: !confirm ? t("required") : confirm !== password ? t("auth:register.mismatch") : undefined,
    };
    setErrors(next);
    setFailure(null);
    if (next.password || next.confirm) return;
    setBusy(true);
    try {
      await resetPassword(token, mobile, password);
      router.replace({ pathname: "/login", params: { reset: "1" } });
    } catch (caught) {
      if (isApiError(caught) && caught.code === "verification_token_invalid") {
        onVerifyAgain();
        return;
      }
      const field = fieldErrors(caught, ["new_password"]).new_password;
      if (field) setErrors({ password: field });
      else setFailure(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      {failure ? <Banner tone="error" message={failure} /> : null}
      <TextField
        label={t("auth:forgot.newPassword")}
        hint={t("auth:register.passwordHint")}
        error={errors.password}
        secret
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        textContentType="newPassword"
        maxLength={128}
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
        editable={!busy}
      />
      <TextField
        ref={confirmRef}
        label={t("auth:register.confirmPassword")}
        error={errors.confirm}
        secret
        value={confirm}
        onChangeText={setConfirm}
        autoComplete="new-password"
        textContentType="newPassword"
        maxLength={128}
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!busy}
      />
      <Button label={t("auth:forgot.submit")} onPress={submit} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
});
