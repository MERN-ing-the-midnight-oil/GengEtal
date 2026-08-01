export default function BurnEstimator({ burn, onCalibrate, busy = false }) {
  if (!burn?.estimate) return null;

  const { estimate, calibration, jobsPerBudget } = burn;
  const cal = calibration || estimate.calibration;

  async function handleCalibrate(e) {
    e.preventDefault();
    if (!onCalibrate) return;
    const fd = new FormData(e.currentTarget);
    const deletedJobs = Number(fd.get('deletedJobs'));
    const live = Number(cal.liveCompletedJobs || 0);
    const calibratedJobs = Number(fd.get('calibratedJobs'));
    await onCalibrate({
      calibratedUnits: Number(fd.get('calibratedUnits')),
      calibratedJobs: Number.isFinite(calibratedJobs)
        ? calibratedJobs
        : live + (Number.isFinite(deletedJobs) ? deletedJobs : 0),
      deletedJobs,
      budgetUnits: Number(fd.get('budgetUnits')),
    });
  }

  return (
    <section className="panel burn-panel">
      <h2>Compute burn estimator</h2>
      <p className="setup-note" style={{ marginTop: 0 }}>
        Rough guide based on your first <strong>{cal.calibratedUnits} CU</strong> across{' '}
        <strong>{cal.calibratedJobs} jobs</strong> (
        {cal.liveCompletedJobs ?? '—'} still in the gallery
        {cal.deletedJobs ? ` + ${cal.deletedJobs} deleted` : ''}
        ). That’s ~{Number(cal.unitsPerBaselineJob).toFixed(1)} CU per Pro/A100/1024/30-step job,
        including setup, idle time, and deleted images.
      </p>

      <div className={`burn-estimate${estimate.expectedCu >= 8 ? ' is-high' : estimate.expectedCu >= 4 ? ' is-mid' : ' is-low'}`}>
        <div className="burn-estimate-main">
          <strong>{estimate.summary}</strong>
          <span>
            Typical range {estimate.lowCu}–{estimate.highCu} CU for the next job with current
            settings
          </span>
        </div>
        <p className="burn-warning">{estimate.warning}</p>
        {jobsPerBudget != null ? (
          <p className="burn-budget">
            At this rate, a <strong>{cal.budgetUnits} CU</strong> budget is about{' '}
            <strong>{jobsPerBudget}</strong> job{jobsPerBudget === 1 ? '' : 's'} (before idle waste).
          </p>
        ) : null}
      </div>

      <details className="burn-calibrate">
        <summary>Recalibrate from Colab usage</summary>
        <form className="burn-calibrate-form" onSubmit={handleCalibrate}>
          <p className="setup-note">
            After a stretch of work, enter how many compute units Colab reports you used and how
            many jobs completed in that stretch.
          </p>
          <div className="burn-calibrate-grid">
            <label>
              Units used
              <input
                name="calibratedUnits"
                type="number"
                min="1"
                step="1"
                defaultValue={cal.calibratedUnits}
                disabled={busy}
              />
            </label>
            <label>
              Deleted jobs
              <input
                name="deletedJobs"
                type="number"
                min="0"
                step="1"
                defaultValue={cal.deletedJobs ?? 0}
                disabled={busy}
              />
            </label>
            <label>
              Total jobs (live + deleted)
              <input
                name="calibratedJobs"
                type="number"
                min="1"
                step="1"
                defaultValue={cal.calibratedJobs}
                disabled={busy}
              />
            </label>
            <label>
              Budget (CU)
              <input
                name="budgetUnits"
                type="number"
                min="0"
                step="1"
                defaultValue={cal.budgetUnits}
                disabled={busy}
              />
            </label>
          </div>
          <button type="submit" className="primary" disabled={busy}>
            Save calibration
          </button>
        </form>
      </details>
    </section>
  );
}
