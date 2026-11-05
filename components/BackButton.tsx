import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function BackButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 mb-5 px-4 py-2 rounded-xl bg-white border border-gray-300 shadow-sm text-sm font-semibold text-gray-900 hover:bg-gray-50 hover:border-gray-400 transition-colors"
    >
      <ArrowLeft size={16} /> {label}
    </Link>
  );
}
