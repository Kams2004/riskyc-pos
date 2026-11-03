export interface MediaItem {
  id: string;
  presignedUrl: string;
  type: "IMAGE" | "VIDEO";
}

export interface ProductVariant {
  id: string;
  colorName: string;
  size: string;
  quantity: number;
  untracked: boolean;
}

export interface ProductColor {
  id?: string;
  name: string;
  hex: string;
}

/** A "buy N for this total" tier, independent of the regular unit price — see PricingService on the backend. */
export interface BulkPriceTier {
  quantity: number;
  price: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  categorySlug: string;
  sizes: string[];
  colors: ProductColor[];
  variants: ProductVariant[];
  media: MediaItem[];
  hidden: boolean;
  bulkPrices: BulkPriceTier[];
}

export interface PosCatalog {
  fetchedAt: string;
  products: Product[];
}

export type PosPaymentMethod = "CASH" | "ORANGE_MONEY" | "MOBILE_MONEY";

export interface PosSaleItem {
  id: string;
  productId: string | null;
  productName: string;
  thumbnailUrl: string | null;
  quantity: number;
  selectedColor: string;
  selectedSize: string;
  unitPrice: number;
}

export interface PosSale {
  id: string;
  clientSaleId: string;
  cashierId: string | null;
  cashierName: string;
  enterpriseId: string | null;
  items: PosSaleItem[];
  total: number;
  paymentMethod: PosPaymentMethod;
  receiptUrl: string | null;
  soldAt: string;
  syncedAt: string;
  stockReconciliationFlag: boolean;
  voided: boolean;
  voidedByName: string | null;
  voidedAt: string | null;
}

/** One line being assembled in the current, not-yet-submitted sale. */
export interface CartLine {
  product: Product;
  selectedColor: string;
  selectedSize: string;
  quantity: number;
}

export type ReceiptPaperWidth = "MM58" | "MM80" | "A4";

/** The configurable ticket — see backend PosSettings' own javadoc. */
export interface PosSettings {
  storeName: string;
  storeAddress: string | null;
  storePhone: string | null;
  footerMessage: string | null;
  showCashierName: boolean;
  showSaleId: boolean;
  paperWidth: ReceiptPaperWidth;
  logoUrl: string | null;
  cashEnabled: boolean;
  orangeMoneyEnabled: boolean;
  mobileMoneyEnabled: boolean;
}

/** One oversold sale line — see the backend's PosReconciliationLineResponse javadoc. */
export interface PosReconciliationLine {
  itemId: string;
  saleId: string;
  soldAt: string;
  cashierName: string;
  productName: string;
  thumbnailUrl: string | null;
  selectedColor: string;
  selectedSize: string;
  quantity: number;
  unitPrice: number;
  stockBefore: number;
  stockAfter: number;
  oversoldBy: number;
  reconciled: boolean;
  reconciledAt: string | null;
  reconciledByName: string | null;
}
