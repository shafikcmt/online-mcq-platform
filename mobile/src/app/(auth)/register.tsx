import { Link } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, View, type TextInputInstance } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError, fieldErrors } from "@/api/describe";
import { isApiError } from "@/api/errors";
import { useAuth } from "@/auth/provider";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { TextField } from "@/components/text-field";
import { OtpStep } from "@/features/auth/otp-step";
import { PhoneStep } from "@/features/auth/phone-step";
import { useLanguage } from "@/i18n/provider";
import { formatBdMobile } from "@/lib/phone";
import { localizeDigits } from "@/lib/text";
import { colors, space } from "@/theme";

type Step = { name: "phone"; notice?: string } | { name: "otp"; mobile: string } | { name: "details"; mobile: string; token: string };

const FIELDS = ["full_name", "email", "password"] as const;

/** Registration: mobile number → SMS code → name, password, optional email. The phone is
 * proven before the account exists; "already registered" is only told to someone who
 * proved they own the number (server rule). */
export default function RegisterScreen() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ name: "phone" });
  const index = step.name === "phone" ? 1 : step.name === "otp" ? 2 : 3;
  const { language } = useLanguage();
  const back = step.name === "otp" ? () => setStep({ name: "phone" }) : undefined;

  return (
    <Screen>
      <PageHeader
        eyebrow={t("auth:stepOf", { current: localizeDigits(index, language), total: localizeDigits(3, language) })}
        title={step.name === "phone" ? t("auth:register.title") : step.name === "otp" ? t("auth:otp.title") : t("auth:register.detailsTitle")}
        subtitle={step.name === "phone" ? t("auth:register.phoneSubtitle") : undefined}
        onBack={back}
      />
      {step.name === "phone" ? (
        <PhoneStep purpose="registration" submitLabel={t("auth:register.sendCode")} notice={step.notice} onSent={(mobile) => setStep({ name: "otp", mobile })} />
      ) : step.name === "otp" ? (
        <OtpStep
          purpose="registration"
          mobileNumber={step.mobile}
          onVerified={(token) => setStep({ name: "details", mobile: step.mobile, token })}
          onChangeNumber={() => setStep({ name: "phone" })}
        />
      ) : (
        <DetailsStep mobile={step.mobile} token={step.token} onVerifyAgain={() => setStep({ name: "phone", notice: t("auth:register.verifyAgain") })} />
      )}
      {step.name === "phone" ? (
        <View style={styles.footer}>
          <AppText color={colors.inkMuted}>{t("auth:register.haveAccount")}</AppText>
          <Link href="/login" asChild>
            <Button variant="secondary" label={t("auth:register.signIn")} />
          </Link>
        </View>
      ) : null}
    </Screen>
  );
}

function DetailsStep({ mobile, token, onVerifyAgain }: { mobile: string; token: string; onVerifyAgain: () => void }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { register } = useAuth();
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [failure, setFailure] = useState<{ message: string; exists: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (busy) return;
    const next: Record<string, string | undefined> = {
      full_name: form.full_name.trim() ? undefined : t("required"),
      password: form.password ? undefined : t("required"),
      confirm: !form.confirm ? t("required") : form.confirm !== form.password ? t("auth:register.mismatch") : undefined,
    };
    setErrors(next);
    setFailure(null);
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    try {
      await register({
        verification_token: token,
        mobile_number: mobile,
        full_name: form.full_name.trim(),
        password: form.password,
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
      });
    } catch (caught) {
      if (isApiError(caught) && caught.code === "verification_token_invalid") {
        onVerifyAgain();
        return;
      }
      const fields = fieldErrors(caught, FIELDS);
      setErrors(fields);
      if (!Object.keys(fields).length) setFailure({ message: describeError(caught, t), exists: isApiError(caught) && caught.code === "account_exists" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Banner tone="success" message={t("auth:register.detailsSubtitle", { phone: localizeDigits(formatBdMobile(mobile), language) })} />
      {failure ? <Banner tone="error" message={failure.message} /> : null}
      {failure?.exists ? (
        <Link href="/login" asChild>
          <Button variant="secondary" label={t("auth:register.signIn")} />
        </Link>
      ) : null}
      <TextField
        label={t("auth:register.fullName")}
        error={errors.full_name}
        value={form.full_name}
        onChangeText={set("full_name")}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        maxLength={150}
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        editable={!busy}
      />
      <TextField
        ref={emailRef}
        label={t("auth:register.email")}
        optionalLabel={t("auth:register.optional")}
        error={errors.email}
        value={form.email}
        onChangeText={set("email")}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={254}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        editable={!busy}
      />
      <TextField
        ref={passwordRef}
        label={t("auth:password")}
        hint={t("auth:register.passwordHint")}
        error={errors.password}
        secret
        value={form.password}
        onChangeText={set("password")}
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
        value={form.confirm}
        onChangeText={set("confirm")}
        autoComplete="new-password"
        textContentType="newPassword"
        maxLength={128}
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!busy}
      />
      <Button label={t("auth:register.submit")} onPress={submit} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
  footer: { gap: space.sm, marginTop: space.md },
});
