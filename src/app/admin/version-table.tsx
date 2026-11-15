import Link from "next/link";
import type { recentVersions } from "@/lib/admin-data";
import { Badge, statusTone, when } from "./ui";

export function VersionTable({ rows }: { rows: Awaited<ReturnType<typeof recentVersions>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-2 pr-3 font-normal">when</th>
            <th className="py-2 pr-3 font-normal">user</th>
            <th className="py-2 pr-3 font-normal">project</th>
            <th className="py-2 pr-3 font-normal">version</th>
            <th className="py-2 pr-3 font-normal">status</th>
            <th className="py-2 pr-3 font-normal">took</th>
            <th className="py-2 font-normal">request / error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.projectId}-${r.version}`} className="border-t border-white/[0.06] align-top">
              <td className="py-2 pr-3 whitespace-nowrap text-muted">{when(r.createdAt)}</td>
              <td className="py-2 pr-3">
                <Link href={`/admin/users/${r.userId}`} className="hover:underline">{r.user}</Link>
              </td>
              <td className="py-2 pr-3">{r.name || (r.kind === "scratch" ? "from scratch" : "remake")}</td>
              <td className="py-2 pr-3 tabular-nums">v{r.version}</td>
              <td className="py-2 pr-3">
                <Badge tone={statusTone(r.status)}>
                  {r.status}
                  {r.status === "processing" ? ` · ${r.stage ?? ""} ${r.progress}%` : ""}
                </Badge>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-muted">
                {r.seconds === null ? "—" : `${Math.floor(r.seconds / 60)}m ${r.seconds % 60}s`}
              </td>
              <td className="max-w-md py-2 text-xs text-muted">
                {r.error ? <span className="text-coral">{r.error}</span> : r.request ? `“${r.request.slice(0, 140)}”` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
