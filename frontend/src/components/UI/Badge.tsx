import '../../css/UI/Badge.css';

const LABELS: Record<string, string> = {
  active:            'Active',
  in_review:         'In review',
  on_hold:           'On hold',
  completed:         'Completed',
  todo:              'To do',
  in_progress:       'In progress',
  overdue:           'Overdue',
  stage_done:        'Stage done',
  pending_manager:   'Awaiting manager',
  pending_admin:     'Awaiting admin',
  pending_client:    'Awaiting client',
  approved:          'Approved',
  changes_requested: 'Changes requested',
};

export default function Badge({ status }: { status: string }) {
  return (
    <span className={`badge badge--${status}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
