import React from 'react';
import { Link } from 'react-router-dom';
import '../css/pages/LandingPage.css';

export default function LandingPage() {
  return (
    <div className="lp-root">
    
      {/* Nav */}
      <nav className="lp-nav">
        <a href="/" className="lp-logo">
          <div className="lp-logo-icon">L</div>
          loooped
        </a>
        <div className="lp-nav-links">
          <a href="#features">Features</a>
          <a href="#ads">Ads API</a>
          <a href="#workflow">How It Works</a>
          <a href="mailto:info@loooped.in">Contact</a>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/login" className="lp-btn-outline">Sign In</Link>
          <Link to="/login" className="lp-btn-dark">Get Started →</Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="lp-hero">
        <div className="lp-tag"><div className="lp-tag-dot" /> loooped Management Platform</div>
        <h1>
          Your loooped,<br />
          <span className="accent">fully in sync.</span>
        </h1>
        <p className="lp-hero-sub">
          Projects, team capacity, client analytics, and ad performance — all connected in one place. Built for digital marketing agencies.
        </p>
        <div className="lp-hero-actions">
          <Link to="/login" className="lp-btn-dark" style={{ fontSize: 14, padding: '11px 24px' }}>Get Started →</Link>
          <a href="#features" className="lp-btn-outline" style={{ fontSize: 14, padding: '11px 24px' }}>Explore features</a>
        </div>
      </div>

      {/* Stats */}
      <div className="lp-stats">
        {[
          { val: '10+', hi: false, lbl: 'Integrated modules' },
          { val: 'Real-time', hi: false, lbl: 'Team tracking' },
          { val: 'GA4', hi: true, lbl: '+ Ads API' },
          { val: '∞', hi: true, lbl: 'Client share links' },
        ].map((s) => (
          <div key={s.lbl} className="lp-glass lp-stat">
            <div className="lp-stat-val">
              {s.hi ? <span className="hi">{s.val}</span> : s.val}
            </div>
            <div className="lp-stat-lbl">{s.lbl}</div>
          </div>
        ))}
      </div>

      {/* Features */}
      <div className="lp-section" id="features">
        <div className="lp-section-label">Platform Features</div>
        <h2 className="lp-section-title">Built for how agencies actually work</h2>
        <p className="lp-section-sub">Every module is designed around the real delivery workflows of digital marketing teams.</p>
        <div className="lp-feature-grid">
          {[
            { icon: '📋', bg: 'rgba(74,144,226,0.1)', title: 'Project & Task Management', desc: 'Create projects, assign tasks, set deadlines, and track estimated vs. actual hours with a full role-based acceptance chain.' },
            { icon: '⏱', bg: 'rgba(76,175,125,0.1)', title: 'Live Time Tracking', desc: 'Built-in start/pause timer on every task. Tracked seconds roll up into daily capacity reports per team member.' },
            { icon: '👥', bg: 'rgba(245,196,24,0.1)', title: 'Team Capacity Dashboard', desc: 'See who is working on what right now. Filter by pod, date, or overdue tasks. Visual progress bars per member.' },
            { icon: '✅', bg: 'rgba(76,175,125,0.1)', title: 'Approval Workflows', desc: 'Manager → admin → client sequential approval flows. Rejection notes loop back to the assignee automatically.' },
            { icon: '📊', bg: 'rgba(74,144,226,0.1)', title: 'SEO Analytics (GA4)', desc: 'Connect GA4 and Search Console per client. View traffic, acquisition, engagement, and rankings in one report.' },
            { icon: '📢', bg: 'rgba(244,115,38,0.1)', title: 'Ads Analytics', desc: 'Pull live Google Ads campaigns, metrics, and ad approval status straight from the Google Ads API.' },
            { icon: '🔗', bg: 'rgba(155,89,182,0.1)', title: 'Shareable Client Reports', desc: 'Generate secure, read-only share links per client. Each link snapshots data at creation so content stays consistent.' },
            { icon: '💰', bg: 'rgba(244,115,38,0.1)', title: 'Project Cost Reports', desc: 'Track salary-based spend per project. Hours logged vs. budget — green / at-risk / critical health indicators.' },
            { icon: '⚡', bg: 'rgba(245,196,24,0.1)', title: 'XLR8 Bucket Billing', desc: 'For retainer clients — track monthly hours used, remaining, and cost against a defined bucket in real time.' },
          ].map((f) => (
            <div key={f.title} className="lp-glass lp-feature-card">
              <div className="lp-feature-icon" style={{ background: f.bg }}>{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Ads API */}
      <div style={{ background: 'rgba(255,255,255,0.35)', borderTop: '1px solid rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.7)', position: 'relative', zIndex: 1 }} id="ads">
        <div className="lp-section" style={{ paddingTop: 72, paddingBottom: 72 }}>
          <div className="lp-section-label">Google Ads API Integration</div>
          <h2 className="lp-section-title">Paid media reporting,<br />inside the platform</h2>
          <p className="lp-section-sub">Loooped integrates directly with the Google Ads API to surface campaign performance and ad policy status for every client account.</p>
          <div className="lp-two-col">
            <div className="lp-glass lp-api-card">
              <h3>How we use the Google Ads API</h3>
              <p>All API calls are server-side and read-only. Data is displayed in private, authenticated dashboards accessible only to authorized loooped staff and their clients.</p>
              <ul className="lp-api-list">
                {[
                  'Campaign-level metrics: impressions, clicks, cost, conversions via GAQL queries',
                  'Ad-level policy summary — approval_status and policy_topic_entries per creative',
                  'Approval status display: Approved, Approved Limited, Disapproved, Under Review',
                  'Disapproval reasons surfaced so agencies can fix non-compliant ads quickly',
                  'Manager account (MCC) support — one token serves multiple client sub-accounts',
                  'Credentials are never exposed to the browser — all calls are server-side only',
                  'Read-only access — Loooped never creates, modifies, or deletes Ads entities',
                  'Access scoped to accounts explicitly configured by loooped administrators',
                ].map((item) => (
                  <li key={item}><div className="lp-api-check">✓</div>{item}</li>
                ))}
              </ul>
            </div>

            {/* Ad Approval Status mock */}
            <div className="lp-mock">
              <div className="lp-mock-header">
                <div className="lp-mock-dot" style={{ background: '#FF5F57' }} />
                <div className="lp-mock-dot" style={{ background: '#FFBD2E' }} />
                <div className="lp-mock-dot" style={{ background: '#28C840' }} />
                <span className="lp-mock-title">Ad Approval Status</span>
              </div>
              <div className="lp-mock-body">
                <div className="lp-mock-section-lbl" style={{ marginBottom: 10 }}>Campaign · Brand Awareness</div>
                {[
                  { badge: 'lp-badge-green', label: '✅ Approved', text: 'Homepage Responsive Ad', extra: null },
                  { badge: 'lp-badge-green', label: '✅ Approved', text: 'Product Feature Video', extra: null },
                  { badge: 'lp-badge-yellow', label: '⚠ Limited', text: 'Retargeting Display', extra: 'Alcohol content' },
                ].map((r) => (
                  <div className="lp-mock-row" key={r.text}>
                    <span className={`lp-badge ${r.badge}`}>{r.label}</span>
                    <span className="lp-mock-row-label">{r.text}</span>
                    {r.extra && <span style={{ fontSize: 11, color: '#c49a00', fontWeight: 600 }}>{r.extra}</span>}
                  </div>
                ))}
                <div className="lp-mock-section-lbl" style={{ margin: '18px 0 10px' }}>Campaign · Search — Brand</div>
                {[
                  { badge: 'lp-badge-red', label: '❌ Disapproved', text: 'Competitor Comparison Ad', extra: 'Trademark' },
                  { badge: 'lp-badge-blue', label: '🔄 In Review', text: 'New Promo Creative', extra: null },
                ].map((r) => (
                  <div className="lp-mock-row" key={r.text}>
                    <span className={`lp-badge ${r.badge}`}>{r.label}</span>
                    <span className="lp-mock-row-label">{r.text}</span>
                    {r.extra && <span style={{ fontSize: 11, color: '#E8424A', fontWeight: 600 }}>{r.extra}</span>}
                  </div>
                ))}

                <div style={{ marginTop: 20, padding: '14px 16px', background: 'rgba(240,240,242,0.7)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', gap: 16 }}>
                    {[{ n: '2', l: 'Approved', c: '#4caf7d' }, { n: '1', l: 'Limited', c: '#c49a00' }, { n: '1', l: 'Disapproved', c: '#E8424A' }].map((s) => (
                      <div key={s.l}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: s.c }}>{s.n}</div>
                        <div style={{ fontSize: 10, color: '#888888', fontWeight: 600 }}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Workflow */}
      <div className="lp-section" id="workflow">
        <div className="lp-two-col" style={{ gap: 56 }}>
          <div>
            <div className="lp-section-label">How It Works</div>
            <h2 className="lp-section-title">Brief to report,<br />one platform</h2>
            <p className="lp-section-sub">Loooped connects every stage of client delivery — no tool switching.</p>
            <div className="lp-workflow">
              {[
                { n: '1', title: 'Create a project, assign tasks', desc: 'Set budgets, due dates, estimated hours. Assign tasks with role-based acceptance — manager, employee, or reviewer.' },
                { n: '2', title: 'Team tracks time and submits', desc: 'Built-in timers log actual hours. When work is done it enters the approval chain — manager, admin, then client.' },
                { n: '3', title: 'Connect analytics per client', desc: 'Link GA4, Search Console, and Google Ads per client. Data pulls automatically into each analytics dashboard.' },
                { n: '4', title: 'Generate and share reports', desc: 'Create secure share links with date ranges. Each link preserves a snapshot of the data for that exact period.' },
              ].map((s) => (
                <div className="lp-workflow-step" key={s.n}>
                  <div className="lp-step-num">{s.n}</div>
                  <div className="lp-step-content">
                    <h4>{s.title}</h4>
                    <p>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SEO Report mock */}
          <div className="lp-mock">
            <div className="lp-mock-header">
              <div className="lp-mock-dot" style={{ background: '#FF5F57' }} />
              <div className="lp-mock-dot" style={{ background: '#FFBD2E' }} />
              <div className="lp-mock-dot" style={{ background: '#28C840' }} />
              <span className="lp-mock-title">Client SEO Report · July 2026</span>
            </div>
            <div className="lp-mock-body">
              <div className="lp-mock-kpi-row">
                {[
                  { val: '1,947', lbl: 'Sessions', chg: '+31%', up: true },
                  { val: '1,435', lbl: 'Users', chg: '+28%', up: true },
                  { val: '49%', lbl: 'Eng. Rate', chg: '−3%', up: false },
                ].map((m) => (
                  <div className="lp-mock-kpi" key={m.lbl}>
                    <div className="lp-mock-kpi-val">{m.val}</div>
                    <div className="lp-mock-kpi-lbl">{m.lbl}</div>
                    <div className={`lp-mock-kpi-chg ${m.up ? 'chg-up' : 'chg-dn'}`}>{m.chg}</div>
                  </div>
                ))}
              </div>
              <div className="lp-mock-section-lbl">Traffic Acquisition</div>
              {[
                ['Organic Search', '528', '+18%'],
                ['Direct', '747', '+44%'],
                ['Paid Search', '453', '+12%'],
                ['Social', '219', '+7%'],
              ].map(([ch, v, chg]) => (
                <div className="lp-mock-row" key={ch}>
                  <span className="lp-mock-row-label">{ch}</span>
                  <span style={{ fontSize: 11, color: '#4caf7d', fontWeight: 700 }}>{chg}</span>
                  <span className="lp-mock-row-val">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Use cases */}
      <div style={{ background: 'rgba(255,255,255,0.35)', borderTop: '1px solid rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.7)', position: 'relative', zIndex: 1 }}>
        <div className="lp-section" style={{ paddingTop: 72, paddingBottom: 72 }}>
          <div className="lp-section-label">Who Uses Loooped</div>
          <h2 className="lp-section-title">Built for agencies of all sizes</h2>
          <p className="lp-section-sub" style={{ marginBottom: 36 }}>From boutique SEO shops to full-service digital agencies managing paid media, content, and dev.</p>
          <div className="lp-use-grid">
            {[
              { icon: '🔍', title: 'SEO & Content Agencies', desc: 'Track organic traffic growth, keyword rankings, and content delivery. Share GA4 reports with clients via branded links.' },
              { icon: '📢', title: 'Paid Media Agencies', desc: 'Monitor Google Ads performance and ad approval status in one view. Catch disapproved ads before clients do.' },
              { icon: '🏢', title: 'Full-Service Agencies', desc: 'Manage projects, track hours, and report across SEO, paid, and social — all from one platform.' },
              { icon: '⚡', title: 'Retainer-Based Studios', desc: 'XLR8 bucket tracking shows monthly hours used vs. allocated. Warning when a retainer hits 80% consumed.' },
            ].map((u) => (
              <div key={u.title} className="lp-glass lp-use-card">
                <div className="lp-use-card-icon">{u.icon}</div>
                <h4>{u.title}</h4>
                <p>{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="lp-cta">
        <h2>Ready to streamline your loooped?</h2>
        <p>Join agencies using Loooped to deliver better work, faster.</p>
        <Link to="/login" className="lp-btn-yellow">Get Started →</Link>
      </div>

      {/* Footer */}
      <footer className="lp-footer">
        <a href="/" className="lp-logo" style={{ fontSize: 16 }}>
          <div className="lp-logo-icon">L</div>
          loooped
        </a>
        <p>© 2026 Loooped. loooped management platform.</p>
        <div className="lp-footer-links">
          <Link to="/login">Login</Link>
          <a href="mailto:info@loooped.in">Contact</a>
          <a href="#ads">Ads API</a>
        </div>
      </footer>
    </div>
  );
}
