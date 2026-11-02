import { PaymentDetail } from "@/components/payments/payment-detail";
import { readPayment } from "@/lib/api/payment-page";
import { titleMetadata } from "@/lib/i18n/metadata";

type Params = Promise<{ publicId: string }>;

export const generateMetadata = () => titleMetadata("paymentDetail.title");

export default async function PaymentPage({ params }: { params: Params }) {
  const payment = await readPayment((await params).publicId);
  return <PaymentDetail payment={payment} />;
}
