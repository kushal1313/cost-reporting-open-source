"use client";

export type TopPeople =
  | { basis: "none"; rows: [] }
  | {
      basis: "cost";
      usageTotal: number;
      unattributedCost: number;
      peopleCount: number;
      rows: Array<{
        userId: string;
        email: string | null;
        name: string | null;
        effectiveCost: number;
        share: number;
        topService: string | null;
      }>;
    }
  | {
      basis: "activity";
      rows: Array<{
        userId: string;
        email: string | null;
        name: string | null;
        messageCount: number;
        sessionCount: number;
      }>;
    };

function personLabel(p: { name: string | null; email: string | null; userId: string }) {
  return (
    <>
      <div>{p.name ?? p.email ?? p.userId}</div>
      {p.name && p.email && <div className="muted">{p.email}</div>}
    </>
  );
}

export function TopPeopleTable({ data }: { data: TopPeople }) {
  if (data.basis === "none") return <p>No per-person data yet — sync or import this connector first.</p>;

  if (data.basis === "activity") {
    return (
      <>
        <p className="muted">
          This plan doesn&apos;t report cost per person, so people are ranked by activity, not spend.
        </p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Person</th>
              <th>Messages</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((p, i) => (
              <tr key={p.userId}>
                <td>{i + 1}</td>
                <td>{personLabel(p)}</td>
                <td>{p.messageCount.toLocaleString()}</td>
                <td>{p.sessionCount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Person</th>
            <th>Usage cost</th>
            <th>Share</th>
            <th>Mostly</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((p, i) => (
            <tr key={p.userId}>
              <td>{i + 1}</td>
              <td>{personLabel(p)}</td>
              <td>${p.effectiveCost.toFixed(2)}</td>
              <td>{(p.share * 100).toFixed(1)}%</td>
              <td>{p.topService ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        {data.peopleCount} people with usage · usage total ${data.usageTotal.toFixed(2)}
        {data.unattributedCost > 0 && ` · $${data.unattributedCost.toFixed(2)} not attributed to anyone`}
        {" · "}seat fees excluded (same for everyone)
      </p>
    </>
  );
}
