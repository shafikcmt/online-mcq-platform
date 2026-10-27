import { Redirect, useLocalSearchParams } from "expo-router";

import { isPaymentId } from "@/features/packages/checkout";

/** Where the payment provider's return link lands (`livemodeltest://payment-result?
 * payment=…&status=…`). The status in the link is ignored — anyone can craft a link — and
 * only a well-formed payment id is used, to ask the server about the student's own
 * payment (another student's payment is "not found"). */
export default function PaymentResultLink() {
  const { payment } = useLocalSearchParams<{ payment?: string }>();
  if (isPaymentId(payment)) return <Redirect href={{ pathname: "/payment/[id]", params: { id: payment } }} />;
  return <Redirect href="/packages" />;
}
