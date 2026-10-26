import { Link, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, View, type TextInputInstance } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { useAuth } from "@/auth/provider";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { TextField } from "@/components/text-field";
import { normalizeBdMobile } from "@/lib/phone";
import { colors, space } from "@/theme";

/** Sign in with mobile number + password. Every failure (unknown number, wrong password,
 * inactive or non-student account) gets the server's one generic message. */
export default function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, notice, clearNotice } = useAuth();
  const params = useLocalSearchParams<{ reset?: string }>();
  const passwordRef = useRef<TextInputInstance>(null);
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ mobile?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const info =
    params.reset === "1"
      ? t("auth:forgot.done")
      : notice === "passwordChanged"
        ? t("profile:password.done")
        : notice === "sessionExpired"
          ? t("errors.sessionExpired")
          : null;

  async function submit() {
    if (busy) return;
    const normalized = normalizeBdMobile(mobile);
    const next = {
      mobile: !mobile.trim() ? t("required") : normalized ? undefined : t("auth:mobileInvalid"),
      password: password ? undefined : t("required"),
    };
    setErrors(next);
    setFailure(null);
    if (next.mobile || next.password || !normalized) return;
    setBusy(true);
    try {
      clearNotice();
      await signIn(normalized, password);
    } catch (caught) {
      setFailure(describeError(caught, t));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.brand}>
        <BrandMark />
      </View>
      <PageHeader title={t("auth:login.title")} subtitle={t("auth:login.subtitle")} onBack={false} />
      {info ? <Banner tone={notice === "sessionExpired" ? "info" : "success"} message={info} /> : null}
      {failure ? <Banner tone="error" message={failure} /> : null}
      <View style={styles.form}>
        <TextField
          label={t("auth:mobile")}
          hint={t("auth:mobileHint")}
          error={errors.mobile}
          prefix="+880"
          value={mobile}
          onChangeText={setMobile}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={20}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!busy}
        />
        <TextField
          ref={passwordRef}
          label={t("auth:password")}
          error={errors.password}
          secret
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
        />
        <Link href="/forgot-password" asChild>
          <Button variant="ghost" compact label={t("auth:login.forgot")} disabled={busy} />
        </Link>
        <Button label={t("auth:login.submit")} onPress={submit} loading={busy} />
      </View>
      <View style={styles.footer}>
        <AppText color={colors.inkMuted}>{t("auth:login.noAccount")}</AppText>
        <Link href="/register" asChild>
          <Button variant="secondary" label={t("auth:login.createAccount")} disabled={busy} />
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: "center", marginTop: space.lg },
  form: { gap: space.lg },
  footer: { gap: space.sm, alignItems: "stretch", marginTop: space.md },
});
