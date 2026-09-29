import type { ReactElement } from "react";
import type { Sale } from "@mercado-pos/contracts";
import { paymentLabel, saleDate, saleMoney, saleUnit } from "../salesPresentation";
import { ReceiptActions } from "./ReceiptActions";

export function SaleDetail({ sale, onClose }: { sale: Sale; onClose: () => void }): ReactElement {
  return <section className="sale-detail" aria-labelledby="sale-detail-title">
    <div className="page-heading">
      <div><p className="eyebrow">Historial local</p><h1 id="sale-detail-title">Detalle de venta</h1></div>
      <button className="quiet-button" onClick={onClose}>← Volver</button>
    </div>
    <div className="invoice-pending-banner" role="note"><div>
      <strong>COMPROBANTE LOCAL — NO ES FACTURA ELECTRÓNICA</strong>
      <span>Estado: venta local. Facturación electrónica pendiente.</span>
    </div></div>
    <div className="sale-detail-card">
      <p className="sale-internal-id"><strong>Identificador interno:</strong> {sale.id}</p>
      <p><strong>Fecha:</strong> {saleDate(sale.createdAt)} (Colombia, UTC−5)</p>
      <p><strong>Registró:</strong> {sale.createdByUsername ?? "Usuario histórico no identificado"}</p>
      <p>Datos e importes conservados al registrar la venta.</p>
      <div className="table-scroll"><table className="sale-detail-table">
        <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th>Importe guardado</th></tr></thead>
        <tbody>{sale.items.map((item) => <tr key={item.productId}>
          <td>{item.productName}</td><td>{item.quantity} {saleUnit(item.unit)}</td>
          <td>{saleMoney(item.unitPriceCop)}</td><td>{saleMoney(item.lineTotalCop)}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="sale-detail-summary">
        <section><h2>Pago registrado</h2>
          <p><strong>Total:</strong> {saleMoney(sale.totalCop)}</p>
          <p><strong>Método:</strong> {paymentLabel(sale.payment.method)}</p>
          <p><strong>Valor pagado:</strong> {saleMoney(sale.payment.amountPaidCop)}</p>
          <p><strong>Cambio:</strong> {saleMoney(sale.payment.changeCop)}</p>
          {sale.payment.reference && <p>Referencia: {sale.payment.reference}</p>}
          {sale.payment.authorizationCode && <p>Autorización declarada: {sale.payment.authorizationCode}</p>}
        </section>
        <section><h2>Comprador de esta venta</h2>
          {sale.buyer ? <>
            <p>{sale.buyer.name}</p>
            {sale.buyer.documentType && <p>{sale.buyer.documentType}: {sale.buyer.documentNumber}</p>}
            {sale.buyer.email && <p>{sale.buyer.email}</p>}
          </> : <p>Sin comprador asociado.</p>}
        </section>
      </div>
      <ReceiptActions key={sale.id} saleId={sale.id} />
    </div>
  </section>;
}
