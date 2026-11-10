export default function AdminHome() {
  return (
    <main className="min-h-screen bg-[#0f1412] text-[#eef2ef]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6">
        <p className="text-xs tracking-[0.24em] text-[#8aa897] uppercase">
          Operations
        </p>
        <h1 className="mt-3 text-5xl tracking-tight sm:text-6xl">Sabu Admin</h1>
        <p className="mt-4 max-w-lg text-[#b7c7be]">
          ERP portal for catalog, inventory, orders, special orders, delivery,
          and finance. Wire screens as APIs land.
        </p>
        <ul className="mt-10 grid gap-2 text-sm text-[#9eb0a6] sm:grid-cols-2">
          {[
            "IAM & RBAC",
            "Catalog & pricing",
            "Inventory",
            "Sales & quotations",
            "Procurement / Dubai",
            "Payments & delivery",
          ].map((item) => (
            <li
              key={item}
              className="border-b border-[#24302a] py-3 text-[#d5e0da]"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
