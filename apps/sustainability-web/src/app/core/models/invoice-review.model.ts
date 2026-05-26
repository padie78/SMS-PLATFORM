/** Parsed line item shown in the invoice validation step */
export interface InvoiceReviewLine {
  description: string;
  value: string;
  unit: string;
  monetary_cost: number;
}

/** UI model for Step 2 (human review before confirm) */
export interface InvoiceReviewView {
  vendor: string;
  vendorTaxId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  cups?: string;
  /** Physical meter serial when OEM sticker differs from logical Meter ID */
  meterSerialNumber?: string;
  contractReference?: string;
  /** Fiscal ID of invoice holder for fallback matching */
  holderTaxId?: string;
  /** Supply point address normalized / raw from OCR */
  supplyAddress?: string;
  tariff?: string;
  total: number;
  netAmount?: number;
  taxAmount?: number;
  currency: string;
  date: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  consumption: number;
  lines: InvoiceReviewLine[];
  confidence: number;
}
