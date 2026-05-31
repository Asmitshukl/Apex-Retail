type Point = {
  label: string;
  value: number;
};

type LineChartProps = {
  title: string;
  subtitle: string;
  points: Point[];
  color?: string;
};

function buildPath(points: Point[], width: number, height: number) {
  const max = Math.max(1, ...points.map((point) => point.value));
  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - (point.value / max) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function LineChart({ title, subtitle, points, color = "#00a878" }: LineChartProps) {
  const width = 640;
  const height = 230;
  const safePoints = points.length > 0 ? points : [{ label: "Now", value: 0 }];
  const path = buildPath(safePoints, width, height);

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <span className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
          Live
        </span>
      </div>
      <div className="mt-6 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height + 34}`} className="h-72 w-full">
          {[0, 1, 2, 3, 4].map((line) => {
            const y = (line / 4) * height;
            return (
              <line
                key={line}
                x1="0"
                x2={width}
                y1={y}
                y2={y}
                stroke="#e5e7eb"
                strokeDasharray="4 6"
              />
            );
          })}
          <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill={color} opacity="0.08" />
          <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
          {safePoints.map((point, index) => {
            const max = Math.max(1, ...safePoints.map((item) => item.value));
            const x = safePoints.length === 1 ? width / 2 : (index / (safePoints.length - 1)) * width;
            const y = height - (point.value / max) * height;
            return (
              <g key={`${point.label}-${index}`}>
                <circle cx={x} cy={y} r="5" fill="#fff" stroke={color} strokeWidth="3" />
                <text x={x} y={height + 28} textAnchor="middle" fontSize="13" fill="#94a3b8">
                  {point.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
