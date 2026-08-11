(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var formId = script.getAttribute('data-form-id');
  if (!formId) return;

  var containerId = 'wa-form-' + formId;
  var container = document.getElementById(containerId);
  if (!container) return;

  // Derive API base from script src or use same origin
  var scriptSrc = script.src || '';
  var apiBase = scriptSrc ? scriptSrc.replace(/\/embed\.js.*$/, '') : window.location.origin;

  // Styles matching the Loooped dashboard design system
  var styleId = 'wa-form-style';
  if (!document.getElementById(styleId)) {
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");',

      '.wa-cf-wrap { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }',

      /* Form layout */
      '.wa-cf-form { max-width: 540px; display: flex; flex-direction: column; gap: 16px; }',

      /* Field wrapper */
      '.wa-cf-field { display: flex; flex-direction: column; gap: 6px; }',

      /* Label — tag chip style */
      '.wa-cf-form label { display: inline-flex; align-items: center; font-size: 11px; font-weight: 700; color: #555555; letter-spacing: 0.05em; text-transform: uppercase; background: rgba(255,255,255,0.75); border: 1px solid rgba(228,228,232,0.9); border-radius: 99px; padding: 3px 10px; width: fit-content; }',

      /* Inputs & textarea — frosted glass style */
      '.wa-cf-form input, .wa-cf-form textarea, .wa-cf-form select { width: 100%; padding: 11px 16px; border: 1.5px solid rgba(255,255,255,0.85); border-radius: 14px; font-size: 14px; font-family: inherit; font-weight: 400; background: rgba(255,255,255,0.70); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); color: #111111; box-sizing: border-box; box-shadow: 0 1px 12px rgba(0,0,0,0.04); transition: border-color 0.15s, box-shadow 0.15s; outline: none; -webkit-appearance: none; appearance: none; }',
      '.wa-cf-form input::placeholder, .wa-cf-form textarea::placeholder { color: #aaaaaa; font-weight: 400; }',
      '.wa-cf-form input:focus, .wa-cf-form textarea:focus, .wa-cf-form select:focus { border-color: #111111; box-shadow: 0 0 0 3px rgba(17,17,17,0.06), 0 1px 12px rgba(0,0,0,0.04); }',
      '.wa-cf-form textarea { min-height: 130px; resize: vertical; line-height: 1.6; }',

      /* Submit button — pill dark */
      '.wa-cf-submit { display: inline-flex; align-items: center; gap: 6px; background: #111111; color: #ffffff; border: none; border-radius: 99px; padding: 11px 26px; font-size: 13px; font-weight: 600; font-family: inherit; letter-spacing: 0.01em; cursor: pointer; transition: background 0.15s, transform 0.1s; align-self: flex-start; margin-top: 4px; }',
      '.wa-cf-submit:hover { background: #333333; }',
      '.wa-cf-submit:active { transform: scale(0.97); }',
      '.wa-cf-submit:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }',

      /* Success state */
      '.wa-cf-success { display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px; background: rgba(76,175,125,0.08); border: 1px solid rgba(76,175,125,0.25); border-radius: 16px; color: #1f6b43; font-size: 14px; font-weight: 600; line-height: 1.5; }',
      '.wa-cf-success-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }',

      /* Error banner */
      '.wa-cf-error-msg { padding: 12px 16px; background: rgba(232,66,74,0.06); border: 1px solid rgba(232,66,74,0.2); border-radius: 12px; color: #b0282e; font-size: 13px; font-weight: 500; margin-bottom: 4px; }',

      /* Per-field error */
      '.wa-cf-field-error { font-size: 11px; font-weight: 600; color: #E8424A; letter-spacing: 0.02em; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function renderDefault(fields, errors, onSubmit) {
    container.className = 'wa-cf-wrap';
    var form = document.createElement('form');
    form.className = 'wa-cf-form';

    fields.forEach(function (field) {
      var wrap = document.createElement('div');
      wrap.className = 'wa-cf-field';

      var label = document.createElement('label');
      label.textContent = field.label + (field.required ? ' *' : '');

      var input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 5;
      } else {
        input = document.createElement('input');
        input.type = field.type || 'text';
      }
      input.name = field.name;
      input.placeholder = field.label;
      if (field.required) input.required = true;

      wrap.appendChild(label);
      wrap.appendChild(input);

      if (errors && errors[field.name]) {
        var err = document.createElement('div');
        err.className = 'wa-cf-field-error';
        err.textContent = errors[field.name];
        wrap.appendChild(err);
      }

      form.appendChild(wrap);
    });

    var btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'wa-cf-submit';
    btn.textContent = 'Send Message →';
    form.appendChild(btn);

    form.addEventListener('submit', onSubmit);
    container.innerHTML = '';
    container.appendChild(form);
  }

  function collectValues(formEl) {
    var values = {};
    var inputs = formEl.querySelectorAll('input[name], textarea[name], select[name]');
    inputs.forEach(function (el) { values[el.name] = el.value; });
    return values;
  }

  function showSuccess() {
    container.innerHTML = '<div class="wa-cf-success"><div class="wa-cf-success-icon">✓</div><div>Your message was sent successfully.<br>We\'ll be in touch soon.</div></div>';
  }

  function showError(msg) {
    var existing = container.querySelector('.wa-cf-error-msg');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.className = 'wa-cf-error-msg';
    div.textContent = msg;
    var form = container.querySelector('form');
    if (form) form.insertAdjacentElement('beforebegin', div);
    else container.insertAdjacentElement('afterbegin', div);
  }

  function makeSubmitHandler(fields) {
    return function (e) {
      e.preventDefault();
      var form = e.target;
      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

      var values = collectValues(form);

      fetch(apiBase + '/api/public/contact-forms/forms/' + formId + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok) {
            showSuccess();
          } else {
            if (btn) { btn.disabled = false; btn.textContent = 'Send Message →'; }
            showError(result.data.error || 'Submission failed. Please try again.');
          }
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Send Message →'; }
          showError('Network error. Please check your connection and try again.');
        });
    };
  }

  // Fetch form config then render
  fetch(apiBase + '/api/public/contact-forms/forms/' + formId)
    .then(function (res) { return res.json(); })
    .then(function (form) {
      var fields = form.fields || [];
      var submitHandler = makeSubmitHandler(fields);

      if (form.template && form.template.trim()) {
        container.className = 'wa-cf-wrap';
        container.innerHTML = form.template;
        var existingForm = container.querySelector('form');
        if (existingForm) {
          existingForm.addEventListener('submit', submitHandler);
        }
      } else {
        renderDefault(fields, null, submitHandler);
      }
    })
    .catch(function () {
      container.innerHTML = '<div class="wa-cf-error-msg">Form could not be loaded.</div>';
    });
})();
