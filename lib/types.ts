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

export type Badge = "NEW" | "SALE" | "HOT";

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  originalPrice?: number | null;
  categorySlug: string;
  subcategorySlug?: string | null;
  sizes: string[];
  tags?: string[];
  rating?: number;
  reviews?: number;
  badge?: Badge | null;
  colors: ProductColor[];
  variants: ProductVariant[];
  media: MediaItem[];
  hidden: boolean;
  bulkPrices: BulkPriceTier[];
}

export interface Subcategory {
  id: string;
  slug: string;
  name: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  subcategories: Subcategory[];
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

export type OrderStatus = "PENDING" | "AWAITING_PAYMENT" | "REVIEWING" | "VALIDATED" | "PACKAGING" | "PACKAGED" | "CANCELLED";

export interface OnlineOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  productThumbnailUrl: string | null;
  quantity: number;
  selectedColor: string | null;
  selectedSize: string | null;
  unitPrice: number;
}

/** An order placed on the storefront/app — the backend's OrderResponse, trimmed to what the POS reads. */
export interface OnlineOrder {
  id: string;
  items: OnlineOrderItem[];
  total: number;
  status: OrderStatus;
  customerInfo: { firstName: string; lastName: string; phone: string; town: string | null; street: string | null; deliveryType: string | null } | null;
  paymentMethod: "ORANGE_MONEY" | "MOBILE_MONEY" | null;
  rejectionReason: string | null;
  packagingCompletedByName: string | null;
  packagingCompletedAt: string | null;
  createdAt: string;
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
  showLogo: boolean;
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
