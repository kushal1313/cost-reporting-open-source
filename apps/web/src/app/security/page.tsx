export default function SecurityScorePage() {
  return (
    <div>
      <h1>Security Score</h1>
      <p className="total">Vulnerability scoring across your connected accounts.</p>

      <div className="card">
        <h2>Coming soon</h2>
        <p style={{ color: "var(--muted)" }}>
          This module isn't built yet — it's here as the second entry in the platform dashboard's module list,
          alongside Cost Reporting. The plan is a connector-based model similar to cost reporting: pull
          vulnerability/posture findings from sources like AWS Security Hub, GuardDuty, or a scanner API,
          normalize them into a common severity scale, and surface a score with drill-down by account/service.
        </p>
      </div>
    </div>
  );
}
