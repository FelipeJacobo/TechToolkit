type Props = { values: number[] };

export default function Sparkline({ values }: Props) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${100 - (v / max) * 100}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" className="h-8 w-24">
      <polyline fill="none" stroke="#6366f1" strokeWidth="3" points={points} />
    </svg>
  );
}
