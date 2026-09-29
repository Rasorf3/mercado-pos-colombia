import { ReceiptRequestSchema, type ReceiptRequest, type ReceiptLayout, type ReceiptResult } from "@mercado-pos/contracts";
import type { SalesService } from "../sales/salesService.ts";
import { validateSalesRequest } from "../sales/salesRequests.ts";
import { renderReceipt } from "./receiptTemplate.ts";

export interface ReceiptDocument {
  print(): Promise<ReceiptResult>;
  pdf(): Promise<Uint8Array>;
  close(): void;
}

export interface ReceiptOutput {
  printerCount(): Promise<number>;
  open(html: string, layout: ReceiptLayout): Promise<ReceiptDocument>;
  selectPdfPath(defaultName: string): Promise<string | null>;
  writePdf(path: string, data: Uint8Array): Promise<void>;
}

// Read-only with respect to SQLite. The output port never receives a database or a sale writer.
export class ReceiptService {
  private busy = false;
  private readonly sales: Pick<SalesService, "getSale">;
  private readonly output: ReceiptOutput;

  constructor(sales: Pick<SalesService, "getSale">, output: ReceiptOutput) {
    this.sales = sales;
    this.output = output;
  }

  print(input: ReceiptRequest): Promise<ReceiptResult> { return this.run(input, "print"); }
  exportPdf(input: ReceiptRequest): Promise<ReceiptResult> { return this.run(input, "pdf"); }

  private async run(input: ReceiptRequest, action: "print" | "pdf"): Promise<ReceiptResult> {
    validateSalesRequest<ReceiptRequest>(ReceiptRequestSchema, input);
    if (this.busy) return { status: "error", message: "Hay otro comprobante en proceso. Termina o cancela su diálogo." };
    this.busy = true;
    let document: ReceiptDocument | undefined;
    try {
      const sale = this.sales.getSale(input.saleId);
      const html = renderReceipt(sale, input.layout);
      if (action === "print" && await this.output.printerCount() === 0) {
        return { status: "error", message: "No hay impresoras instaladas. Puedes guardar el comprobante como PDF." };
      }
      const path = action === "pdf"
        ? await this.output.selectPdfPath(`comprobante-local-${sale.id}-${input.layout.paperWidthMm}mm.pdf`)
        : null;
      if (action === "pdf" && !path) return { status: "cancelled", message: "Guardado de PDF cancelado." };
      document = await this.output.open(html, input.layout);
      if (action === "print") return await document.print();
      await this.output.writePdf(path!, await document.pdf());
      return { status: "saved", message: "Comprobante PDF guardado en la ubicación elegida." };
    } catch {
      return { status: "error", message: action === "print"
        ? "No se pudo imprimir el comprobante. Revisa la venta, la impresora y su configuración de papel."
        : "No se pudo guardar el PDF. Revisa la venta y los permisos de la ubicación elegida." };
    } finally {
      document?.close();
      this.busy = false;
    }
  }
}
