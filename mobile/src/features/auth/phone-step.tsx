import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError, fieldErrors } from "@/api/describe";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import type { OtpPurpose } from "@/auth/types";
import { useLanguage } from "@/i18n/provider";
import { normalizeBdMobile } from "@/lib/phone";
import { space } from "@/theme";

import { requestOtp } from "./api";

type Props = {
  purpose: OtpPurpose;
  submitLabel: string;
  initialValue?: string;
  notice?: string | null;
  /** Called with the canonical +880… number once the server accepted the request. */
  onSent: (mobileNumber: string) => void;
};

/** Step 1 of registration and password reset: the mobile number, then "send code". The
 * server answers the same way for every number (it never says whether one is registered). */
export function PhoneStep({ purpose, submitLabel, initialValue = "", notice, onSent }: Props) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const mobile = normalizeBdMobile(value);
    setFailure(null);
    if (!mobile) {
      setError(value.trim() ? t("auth:mobileInvalid") : t("required"));
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await requestOtp(mobile, purpose, language);
      onSent(mobile);
    } catch (caught) {
      const field = fieldErrors(caught, ["mobile_number"]).mobile_number;
      if (field) setError(field);
      else setFailure(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.xl }}>
      {notice ? <Banner tone="info" message={notice} /> : null}
      {failure ? <Banner tone="error" message={failure} /> : null}
      <TextField
        label={t("auth:mobile")}
        hint={t("auth:mobileHint")}
        error={error}
        prefix="+880"
        value={value}
        onChangeText={setValue}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={20}
        returnKeyType="send"
        onSubmitEditing={submit}
        editable={!busy}
      />
      <Button label={submitLabel} onPress={submit} loading={busy} />
    </View>
  );
}
