interface SubsetLabelProps {
  name: string;
  className?: string;
}

/** Compact, but never clipped: even unbroken parallel names can wrap. */
export function SubsetLabel({ name, className = "" }: SubsetLabelProps) {
  return (
    <p
      title={name}
      className={`min-w-0 text-[11px] leading-4 whitespace-normal [overflow-wrap:anywhere] ${className}`}
    >
      {name}
    </p>
  );
}
