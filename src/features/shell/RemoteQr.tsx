import qrcode from "qrcode-generator";
import { useMemo } from "react";

const quiet_modules = 4;

const qr_shape = (text: string) => {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row += 1) {
    let col = 0;
    while (col < count) {
      if (!code.isDark(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < count && code.isDark(row, col)) {
        col += 1;
      }
      path += `M${start + quiet_modules} ${row + quiet_modules}h${col - start}v1h${start - col}z`;
    }
  }
  return { path, size: count + 2 * quiet_modules };
};

export const RemoteQr = ({ text, label }: { text: string; label: string }) => {
  const { path, size } = useMemo(() => qr_shape(text), [text]);
  return (
    <svg className="remote-qr" width={176} height={176} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <path className="remote-qr-modules" d={path} />
    </svg>
  );
};
