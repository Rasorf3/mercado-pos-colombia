import { ReceiptLayoutSchema, type ReceiptLayout, type Sale } from "@mercado-pos/contracts";
import { saleMoney, saleDate, paymentLabel, saleUnit } from "../../salesPresentation.ts";
import { validateSalesRequest } from "../sales/salesRequests.ts";

export function escapeReceiptText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}

export function renderReceipt(sale: Sale, layout: ReceiptLayout): string {
  validateSalesRequest<ReceiptLayout>(ReceiptLayoutSchema, layout);
  if (sale.status !== "local_pending_invoice") throw new Error("Estado de venta local no compatible.");
  const text = escapeReceiptText;
  const money = (value: string) => text(saleMoney(value));
  const buyer = sale.buyer;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Comprobante local ${text(sale.id)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: black; }
  body { width: ${layout.paperWidthMm - layout.marginMm * 2}mm; font: 9pt/1.35 Arial, sans-serif; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th, td { padding: 2mm 0; text-align: left; font-weight: normal; vertical-align: top; overflow-wrap: anywhere; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  h1 { margin: 0 0 2mm; font-size: 10pt; line-height: 1.3; text-align: center; }
  p { margin: 1mm 0; }
  .pending { font-weight: bold; text-align: center; border: 1px solid black; padding: 1mm; margin: 0 0 2mm; }
  .meta { font-size: 8pt; }
  .item { border-top: 1px dashed #777; }
  .name { font-weight: bold; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .total { font-weight: bold; font-size: 12pt; }
  .summary { border-top: 2px solid black; }
  .pair { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 2mm; margin: 1mm 0; }
  .pair span:last-child { margin-left: auto; text-align: right; overflow-wrap: anywhere; max-width: 100%; }
  .foot { font-size: 8pt; text-align: center; border-top: 1px dashed #777; }
</style></head><body>
<table aria-label="Comprobante local"><thead><tr><th>
  <h1>COMPROBANTE LOCAL — NO ES FACTURA ELECTRÓNICA</h1>
  <p class="pending">Facturación electrónica pendiente</p>
  <p class="meta">Identificador interno:<br>${text(sale.id)}</p>
  <p class="meta">Fecha: ${text(saleDate(sale.createdAt))} (UTC−5)</p>
  <p class="meta">Valores en COP</p>
</th></tr></thead><tbody>
${buyer ? `<tr><td><strong>Comprador</strong><p>${text(buyer.name)}</p>
${buyer.documentType && buyer.documentNumber ? `<p>${text(buyer.documentType)}: ${text(buyer.documentNumber)}</p>` : ""}
${buyer.email ? `<p>${text(buyer.email)}</p>` : ""}</td></tr>` : ""}
${sale.items.map((item) => `<tr><td class="item">
  <p class="name">${text(item.productName)}</p>
  <p>${text(item.quantity)} ${text(saleUnit(item.unit))} × ${money(item.unitPriceCop)}</p>
  ${item.discount ? `<p>Descuento ${text(item.discount.type === "percentage" ? `${item.discount.value}%` : `${saleMoney(item.discount.valueCop)} por unidad`)}: −${money(item.discountTotalCop)}</p>` : ""}
  <p class="amount">Importe: <strong>${money(item.lineTotalCop)}</strong></p>
</td></tr>`).join("")}
<tr><td class="summary">
  <p class="pair total"><span>Total registrado</span><span>${money(sale.totalCop)}</span></p>
  <p class="pair"><span>Medio de pago</span><span>${text(paymentLabel(sale.payment.method))}</span></p>
  <p class="pair"><span>Valor pagado</span><span>${money(sale.payment.amountPaidCop)}</span></p>
  ${sale.payment.method === "cash" ? `<p class="pair"><span>Cambio</span><span>${money(sale.payment.changeCop)}</span></p>` : ""}
  ${sale.payment.reference ? `<p>Referencia: ${text(sale.payment.reference)}</p>` : ""}
  ${sale.payment.authorizationCode ? `<p>Autorización declarada: ${text(sale.payment.authorizationCode)}</p>` : ""}
</td></tr>
<tr><td class="foot">Venta local. Facturación electrónica pendiente.<br>No acredita emisión ni validación ante la DIAN.</td></tr>
</tbody></table></body></html>`;
}
