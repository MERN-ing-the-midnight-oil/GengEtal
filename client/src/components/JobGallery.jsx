import { groupJobsBySharedPrompts } from '../groupJobs.js';
import JobCard from './JobCard.jsx';

export default function JobGallery({
  jobs,
  loading,
  notebookUrl,
  onOpenNotebook,
  onReroll,
  onDelete,
}) {
  if (loading && jobs.length === 0) {
    return <div className="empty">Loading jobs…</div>;
  }

  if (jobs.length === 0) {
    return (
      <div className="empty">
        No jobs yet. Queue a prompt pair above to generate a visual anagram.
      </div>
    );
  }

  const groups = groupJobsBySharedPrompts(jobs);

  return (
    <div className="gallery">
      {groups.map((group) => {
        const cards = group.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            notebookUrl={notebookUrl}
            onOpenNotebook={onOpenNotebook}
            onReroll={onReroll}
            onDelete={onDelete}
          />
        ));

        if (group.length === 1) {
          return cards[0];
        }

        return (
          <div className="job-group" key={group.map((j) => j.id).join('-')}>
            {cards}
          </div>
        );
      })}
    </div>
  );
}
