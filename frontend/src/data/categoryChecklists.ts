export interface ChecklistItem {
  text: string;
  checked: boolean; // pre-checked = important default
}

export interface CategoryChecklist {
  emoji: string;
  label: string;
  items: ChecklistItem[];
}

export const CATEGORY_CHECKLISTS: Record<string, CategoryChecklist> = {
  'Ads Specialist': {
    emoji: '📢',
    label: 'Ads Specialist',
    items: [
      { text: 'Campaign objective defined',       checked: true  },
      { text: 'Target audience finalized',        checked: true  },
      { text: 'Keywords researched',              checked: false },
      { text: 'Ad copy approved',                 checked: true  },
      { text: 'Creatives uploaded',               checked: true  },
      { text: 'Landing page verified',            checked: true  },
      { text: 'Conversion tracking configured',   checked: false },
      { text: 'Budget & bidding configured',      checked: true  },
      { text: 'Campaign tested',                  checked: true  },
      { text: 'Campaign launched',                checked: true  },
      { text: 'QA completed',                     checked: true  },
      { text: 'Performance report shared',        checked: false },
    ],
  },

  'SEO Specialist': {
    emoji: '🔍',
    label: 'SEO Specialist',
    items: [
      { text: 'Keyword research completed',        checked: true  },
      { text: 'Competitor analysis completed',     checked: false },
      { text: 'SEO strategy finalized',            checked: true  },
      { text: 'Meta Title added',                  checked: true  },
      { text: 'Meta Description added',            checked: true  },
      { text: 'URL optimized',                     checked: true  },
      { text: 'Heading structure (H1-H6) verified',checked: true  },
      { text: 'Image ALT tags added',              checked: true  },
      { text: 'Internal linking completed',        checked: false },
      { text: 'Sitemap updated',                   checked: true  },
      { text: 'Robots.txt verified',              checked: false },
      { text: 'Schema markup added',               checked: false },
      { text: 'Canonical URLs configured',         checked: false },
      { text: 'Core Web Vitals checked',           checked: true  },
      { text: 'Page indexed in Google',            checked: true  },
      { text: 'SEO QA completed',                  checked: true  },
    ],
  },

  'Sales Executive': {
    emoji: '💼',
    label: 'Sales Executive',
    items: [
      { text: 'Client requirements collected',  checked: true  },
      { text: 'Requirement document prepared',  checked: true  },
      { text: 'Proposal submitted',             checked: true  },
      { text: 'Budget approved',                checked: true  },
      { text: 'Timeline confirmed',             checked: true  },
      { text: 'Contract signed',                checked: true  },
      { text: 'Initial payment received',       checked: false },
      { text: 'Project kickoff completed',      checked: true  },
      { text: 'Internal team briefed',          checked: true  },
      { text: 'Client communication updated',   checked: false },
      { text: 'Delivery confirmed',             checked: true  },
      { text: 'Client approval received',       checked: true  },
    ],
  },

  'Social Media Manager': {
    emoji: '📱',
    label: 'Social Media Manager',
    items: [
      { text: 'Campaign goal finalized',       checked: true  },
      { text: 'Content strategy prepared',     checked: true  },
      { text: 'Content calendar approved',     checked: true  },
      { text: 'Graphics received',             checked: true  },
      { text: 'Captions finalized',            checked: true  },
      { text: 'Hashtags researched',           checked: false },
      { text: 'CTA added',                     checked: true  },
      { text: 'Posts scheduled',               checked: true  },
      { text: 'Links verified',                checked: true  },
      { text: 'QA completed',                  checked: true  },
      { text: 'Campaign published',            checked: true  },
      { text: 'Analytics tracking enabled',    checked: false },
    ],
  },

  'UI/UX Designer': {
    emoji: '🎨',
    label: 'UI/UX Designer',
    items: [
      { text: 'Requirements reviewed',          checked: true  },
      { text: 'User flow completed',            checked: true  },
      { text: 'Wireframes approved',            checked: true  },
      { text: 'High-fidelity UI completed',     checked: true  },
      { text: 'Design system followed',         checked: true  },
      { text: 'Components created',             checked: true  },
      { text: 'Responsive designs completed',   checked: true  },
      { text: 'Prototype linked',               checked: false },
      { text: 'Accessibility checked',          checked: false },
      { text: 'Assets exported',                checked: true  },
      { text: 'Developer handoff completed',    checked: true  },
      { text: 'Client approval received',       checked: true  },
    ],
  },

  'Web Developer': {
    emoji: '💻',
    label: 'Web Developer',
    items: [
      // Planning
      { text: 'Requirements understood',             checked: true  },
      { text: 'Technical approach finalized',        checked: true  },
      // Development
      { text: 'Frontend completed',                  checked: true  },
      { text: 'Backend completed',                   checked: true  },
      { text: 'Database implemented',                checked: false },
      { text: 'API integration completed',           checked: true  },
      { text: 'Third-party integrations completed',  checked: false },
      // Quality
      { text: 'Responsive design verified',          checked: true  },
      { text: 'Cross-browser testing completed',     checked: true  },
      { text: 'Performance optimized',               checked: false },
      { text: 'Security checks completed',           checked: true  },
      { text: 'Forms validated',                     checked: true  },
      { text: 'Error handling implemented',          checked: true  },
      // Deployment
      { text: 'Code reviewed',                       checked: true  },
      { text: 'Git merged',                          checked: true  },
      { text: 'Build successful',                    checked: true  },
      { text: 'Staging tested',                      checked: true  },
      { text: 'Production deployed',                 checked: true  },
      { text: 'Backup taken',                        checked: false },
      // Final
      { text: 'Documentation updated',               checked: false },
      { text: 'Client feedback addressed',           checked: true  },
      { text: 'Final QA completed',                  checked: true  },
      { text: 'Client approval received',            checked: true  },
      { text: 'Task marked complete',                checked: true  },
    ],
  },
};

// Normalize category names (handle slight spelling differences)
export function getChecklistForCategory(name: string): CategoryChecklist | null {
  // exact match first
  if (CATEGORY_CHECKLISTS[name]) return CATEGORY_CHECKLISTS[name];
  // case-insensitive match
  const key = Object.keys(CATEGORY_CHECKLISTS).find(
    k => k.toLowerCase() === name.toLowerCase()
  );
  return key ? CATEGORY_CHECKLISTS[key] : null;
}
