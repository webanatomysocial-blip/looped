import '../../css/UI/Badge.css';

const LABELS: Record<string, string> = {
  active:            'Active',
  in_review:         'Submitted',
  on_hold:           'On hold',
  completed:         'Approved',
  draft:             'Draft',
  todo:              'Waiting',
  in_progress:       'Working',
  overdue:           'Delayed',
  stage_done:        'Stage done',
  pending_approval:  'Pending Approval',
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
