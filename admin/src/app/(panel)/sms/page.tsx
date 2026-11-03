import { SmsGatewayView } from "@/components/sms/sms-gateway-view";
import { adminRead } from "@/lib/api/server";
import { titleMetadata } from "@/lib/i18n/metadata";
import type { SmsGateway } from "@/types/sms";

export const generateMetadata = () => titleMetadata("sms.title");

export default async function SmsPage() {
  const gateway = await adminRead<SmsGateway>("/admin/sms/gateway/");
  return <SmsGatewayView gateway={gateway} />;
}
