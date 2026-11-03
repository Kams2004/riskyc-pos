import clsx from "clsx";

export default function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative w-10 h-6 rounded-full flex-shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        checked ? "bg-brand-500" : "bg-gray-200"
      )}
    >
      <span
        className={clsx(
          "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-4"
        )}
      />
    </button>
  );
}
