import JobCard from './JobCard.jsx';

export default function JobGallery({
  jobs,
  loading,
  onUsePrompts,
  onDelete,
  onPublish,
  onUnpublish,
  colabAlive = false,
  readOnly = false,
  emptyMessage = null,
}) {
  if (loading && jobs.length === 0) {
    return <div className="empty">Loading jobs…</div>;
  }

  if (jobs.length === 0) {
    return (
      <div className="empty">
        {emptyMessage ||
          'No jobs yet. Queue a prompt pair above to generate a visual anagram.'}
      </div>
    );
  }

  return (
    <div className="gallery">
      {jobs.map((job) => (
        <JobCard
          key={job.friend_id ? `${job.friend_id}:${job.id}` : job.id}
          job={job}
          onUsePrompts={onUsePrompts}
          onDelete={readOnly ? undefined : onDelete}
          onPublish={readOnly ? undefined : onPublish}
          onUnpublish={readOnly ? undefined : onUnpublish}
          colabAlive={colabAlive}
          readOnly={readOnly}
          friendLabel={job.friend_label || null}
        />
      ))}
    </div>
  );
}
