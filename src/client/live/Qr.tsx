import qrcode from "qrcode-generator";

export function Qr({ value, size = 180 }: { value: string; size?: number }) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  const rects: React.ReactNode[] = [];
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (qr.isDark(r, c)) {
        rects.push(<rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} />);
      }
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="rounded-xl bg-white p-2.5 shadow-panel"
      role="img"
      aria-label="Room QR code"
    >
      <g fill="#0a0d12">{rects}</g>
    </svg>
  );
}
