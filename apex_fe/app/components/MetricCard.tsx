type MetricCardProps = {
  label: string;
  value: string;
  hint: string;
  icon: string;
};

export function MetricCard({ label, value, hint, icon }: MetricCardProps) {
  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-emerald-50 text-xl text-emerald-700">
          {icon}
        </span>
      </div>
      <p className="mt-6 inline-flex rounded-lg bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
        {hint}
      </p>
    </section>
  );
}
