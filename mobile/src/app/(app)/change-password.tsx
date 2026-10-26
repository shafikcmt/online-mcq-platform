import { useRef, useState } from "react";
import { StyleSheet, View, type TextInputInstance } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError, fieldErrors } from "@/api/describe";
import { useAuth } from "@/auth/provider";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { TextField } from "@/components/text-field";
import { space } from "@/theme";

/** Change password (needs the current one). Success signs out every device, this one too
 * — the sign-in screen then says so. */
export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const { changePassword } = useAuth();
  const newRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (busy) return;
    const next = {
      current: form.current ? undefined : t("required"),
      next: form.next ? undefined : t("required"),
      confirm: !form.confirm ? t("required") : form.confirm !== form.next ? t("auth:register.mismatch") : undefined,
    };
    setErrors(next);
    setFailure(null);
    if (next.current || next.next || next.confirm) return;
    setBusy(true);
    try {
      await changePassword(form.current, form.next);
    } catch (caught) {
      const fields = fieldErrors(caught, ["current_password", "new_password"]);
      setErrors({ current: fields.current_password, next: fields.new_password });
      if (!fields.current_password && !fields.new_password) setFailure(describeError(caught, t));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <PageHeader title={t("profile:changePassword")} />
      <Banner tone="info" message={t("profile:password.note")} />
      {failure ? <Banner tone="error" message={failure} /> : null}
      <View style={styles.form}>
        <TextField
          label={t("profile:password.current")}
          error={errors.current}
          secret
          value={form.current}
          onChangeText={set("current")}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="next"
          onSubmitEditing={() => newRef.current?.focus()}
          editable={!busy}
        />
        <TextField
          ref={newRef}
          label={t("profile:password.new")}
          hint={t("auth:register.passwordHint")}
          error={errors.next}
          secret
          value={form.next}
          onChangeText={set("next")}
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
        <Button label={t("profile:password.submit")} onPress={submit} loading={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: space.lg } });
